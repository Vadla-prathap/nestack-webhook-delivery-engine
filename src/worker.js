const db = require("./db");
const { nowIso } = require("./events");
const { signPayload } = require("./signature");

const RETRY_DELAYS_MS = [
  2_000,
  2_000,
  2_000
];
const pollIntervalMs = Math.max(
  250, Number(process.env.WORKER_POLL_INTERVAL_MS || 1000)
);
const timeoutMs = Math.max(
  1000, Number(process.env.DELIVERY_TIMEOUT_MS || 10000)
);
const secret = process.env.WEBHOOK_SECRET;

let running = false;
let stopped = false;

function claimNextEvent() {
  const now = nowIso();
  const lockUntil = new Date(
    Date.now() + timeoutMs + 15000
  ).toISOString();

  return db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM events
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (locked_until IS NULL OR locked_until <= ?)
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT 1
    `).get(now, now);

    if (!row) return null;

    const result = db.prepare(`
      UPDATE events
      SET locked_until = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
        AND (locked_until IS NULL OR locked_until <= ?)
    `).run(lockUntil, now, row.id, now);

    return result.changes ? row : null;
  })();
}

async function deliver(row) {
  const startedAt = Date.now();
  const attemptedAt = nowIso();

  let httpStatus = null;
  let error = null;
  let success = false;

  try {
    const body = Buffer.from(JSON.stringify({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      created_at: row.created_at
    }), "utf8");

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(), timeoutMs
    );

    try {
      const response = await fetch(row.webhook_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Nestack-Webhook-Delivery-Engine/1.0",
          "x-webhook-signature": signPayload(body, secret)
        },
        body,
        signal: controller.signal,
        redirect: "manual"
      });

      httpStatus = response.status;
      success = response.status >= 200 &&
        response.status < 300;

      if (!success) error = `HTTP ${response.status}`;

      await response.arrayBuffer().catch(() => {});
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    error = err.name === "AbortError"
      ? `Request timed out after ${timeoutMs}ms`
      : (err.message || "Network error");
  }

  const finishedAt = nowIso();
  const durationMs = Date.now() - startedAt;

  db.transaction(() => {
    const current = db.prepare(`
      SELECT * FROM events WHERE id = ?
    `).get(row.id);

    if (!current || current.status !== "pending") return;

    db.prepare(`
      INSERT INTO attempts (
        event_id, attempted_at, http_status,
        outcome, error, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      row.id, attemptedAt, httpStatus,
      success ? "success" : "failed",
      error, durationMs
    );

    if (success) {
      db.prepare(`
        UPDATE events
        SET status = 'delivered',
            updated_at = ?,
            next_attempt_at = NULL,
            locked_until = NULL,
            last_error = NULL
        WHERE id = ?
      `).run(finishedAt, row.id);
      return;
    }

    const nextAttemptNumber =
      current.attempts_in_cycle + 1;

    if (nextAttemptNumber >= 4) {
      db.prepare(`
        UPDATE events
        SET status = 'dead',
            attempts_in_cycle = ?,
            updated_at = ?,
            next_attempt_at = NULL,
            locked_until = NULL,
            last_error = ?
        WHERE id = ?
      `).run(
        nextAttemptNumber, finishedAt,
        error || "Delivery failed", row.id
      );
      return;
    }

    const delay = RETRY_DELAYS_MS[
      nextAttemptNumber - 1
    ];
    const nextAttemptAt = new Date(
      Date.now() + delay
    ).toISOString();

    db.prepare(`
      UPDATE events
      SET status = 'pending',
          attempts_in_cycle = ?,
          updated_at = ?,
          next_attempt_at = ?,
          locked_until = NULL,
          last_error = ?
      WHERE id = ?
    `).run(
      nextAttemptNumber, finishedAt,
      nextAttemptAt, error || "Delivery failed",
      row.id
    );
  })();
}

async function tick() {
  if (running || stopped) return;
  running = true;

  try {
    const event = claimNextEvent();
    if (event) await deliver(event);
  } catch (err) {
    console.error("[worker] Unexpected error:", err);
  } finally {
    running = false;
  }
}

function startWorker() {
  if (!secret) {
    throw new Error("WEBHOOK_SECRET must be configured.");
  }

  console.log(
    `[worker] Started; polling every ${pollIntervalMs}ms`
  );

  const timer = setInterval(tick, pollIntervalMs);
  timer.unref();
  tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { startWorker, RETRY_DELAYS_MS };