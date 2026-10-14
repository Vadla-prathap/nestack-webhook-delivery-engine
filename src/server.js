const { isSafeWebhookUrl } = require("./urlSafety");
require("dotenv").config();

const express = require("express");
const db = require("./db");
const {
  createEvent,
  listEvents,
  getEvent,
  retryDeadEvent
} = require("./events");
const { startWorker } = require("./worker");

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

if (!process.env.WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET.length < 16) {
  console.error(
    "Set WEBHOOK_SECRET to at least 16 characters."
  );
  process.exit(1);
}

app.use(express.json({ limit: "1mb", strict: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "webhook-delivery-engine"
  });
});

app.post("/events", (req, res) => {
  const { type, payload, webhook_url } = req.body || {};

  if (typeof type !== "string" ||
      !type.trim() || type.length > 200) {
    return res.status(400).json({
      error: "type must be a non-empty string of at most 200 characters."
    });
  }

  if (payload === undefined) {
    return res.status(400).json({
      error: "payload is required."
    });
  }

  if (typeof webhook_url !== "string") {
    return res.status(400).json({
      error: "webhook_url must be an HTTP or HTTPS URL."
    });
  }

  let target;
  try {
    target = new URL(webhook_url);
  } catch {
    return res.status(400).json({
      error: "Invalid webhook_url."
    });
  }

  if (!["http:", "https:"].includes(target.protocol) ||
      target.username || target.password) {
    return res.status(400).json({
      error: "webhook_url must use HTTP/HTTPS without embedded credentials."
    });
  }

  try {
    const event = createEvent({
      type: type.trim(),
      payload,
      webhook_url: target.toString()
    });

    return res.status(201).json(event);
  } catch (err) {
    console.error("[api] Create event failed:", err);
    return res.status(500).json({
      error: "Could not create event."
    });
  }
});

app.get("/events", (_req, res) => {
  try {
    return res.status(200).json(listEvents());
  } catch (err) {
    console.error("[api] List events failed:", err);
    return res.status(500).json({
      error: "Could not list events."
    });
  }
});

app.get("/events/:id", (req, res) => {
  const event = getEvent(req.params.id);

  if (!event) {
    return res.status(404).json({
      error: "Event not found."
    });
  }

  return res.status(200).json(event);
});

app.post("/events/:id/retry", (req, res) => {
  const result = retryDeadEvent(req.params.id);

  if (result.kind === "not_found") {
    return res.status(404).json({
      error: "Event not found."
    });
  }

  if (result.kind === "not_dead") {
    return res.status(400).json({
      error: "Only dead events can be retried manually.",
      event: result.event
    });
  }

  return res.status(200).json(result.event);
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: "Request body contains invalid JSON."
    });
  }

  console.error("[api] Unhandled error:", err);
  return res.status(500).json({
    error: "Internal server error."
  });
});

let stopWorker;

const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);

  try {
    stopWorker = startWorker();
  } catch (err) {
    console.error(err.message);
    server.close(() => process.exit(1));
  }
});

function shutdown(signal) {
  console.log(`[server] ${signal}; shutting down`);

  if (stopWorker) stopWorker();

  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));