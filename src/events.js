
app.post("/events", async (req, res) => {
  const { type, payload, webhook_url } = req.body || {};

  // Validate event type.
  if (
    typeof type !== "string" ||
    !type.trim() ||
    type.length > 200
  ) {
    return res.status(400).json({
      error: "type must be a non-empty string of at most 200 characters."
    });
  }

  // Validate payload.
  if (payload === undefined) {
    return res.status(400).json({
      error: "payload is required."
    });
  }

  // Validate webhook URL type.
  if (typeof webhook_url !== "string") {
    return res.status(400).json({
      error: "webhook_url must be a valid HTTPS URL."
    });
  }

  // Parse URL safely.
  let target;

  try {
    target = new URL(webhook_url);
  } catch {
    return res.status(400).json({
      error: "Invalid webhook_url."
    });
  }

  // Validate destination using src/urlSafety.js.
  try {
    const safe = await isSafeWebhookUrl(target.toString());

    if (!safe) {
      return res.status(400).json({
        error: "Webhook URL must use HTTPS and resolve only to public IP addresses."
      });
    }
  } catch (err) {
    console.error("[api] Webhook URL validation failed:", err);

    return res.status(400).json({
      error: "Webhook URL could not be validated."
    });
  }

  // Create event only after validation succeeds.
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
