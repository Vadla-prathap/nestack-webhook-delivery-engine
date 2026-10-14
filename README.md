# Nestack Webhook Delivery Engine

A webhook API built with Node.js, Express, and SQLite.
It includes a background delivery worker, automatic retries,
attempt history, and HMAC-SHA256 request signing.

## Requirements

- Node.js 20 or newer
- npm

## Local setup

1. Install dependencies:

   npm install

2. Copy `.env.example` to `.env`.

3. Set a private `WEBHOOK_SECRET` of at least 16 characters.

4. Start the application:

   npm start

The API runs on http://localhost:3000.

## API endpoints

### POST /events

Creates a webhook event.

Example JSON:

{
  "type": "payment.failed",
  "payload": {
    "payment_id": "PAY123",
    "amount": 500
  },
  "webhook_url": "https://your-receiver.example/webhook"
}

Returns 201 with the created event.

### GET /events

Returns all events with their attempt histories.

### GET /events/:id

Returns one event and its attempts.
Returns 404 if the event does not exist.

### POST /events/:id/retry

Manually retries an event only when its status is dead.
Returns 400 for an event that is not dead.

### GET /health

Returns the service health status.

## Retry schedule

The first delivery is attempted immediately.

After failed attempt 1: wait 30 seconds.
After failed attempt 2: wait 5 minutes.
After failed attempt 3: wait 30 minutes.
After failed attempt 4: mark the event dead.

Any HTTP 2xx response marks an event delivered.
Non-2xx responses, timeouts, and network errors count as failures.

## HMAC-SHA256

Outgoing requests include the X-Webhook-Signature header.

Its format is:

sha256=<64-character-hex-digest>

The digest is HMAC-SHA256 over the exact UTF-8 bytes
of the outgoing JSON body, using WEBHOOK_SECRET as the key.

The receiver must verify the raw request bytes.
Never publish the signing secret.

## Background worker and restarts

The worker runs in the same process as the API and polls
SQLite for due events. Retry timestamps and attempt history
are persisted, so scheduled retries survive a restart if the
database file is stored on persistent storage.

If a process crashes during delivery, its temporary lock
expires and the pending event can be picked up again.
This can result in duplicate delivery if the receiver accepted
the request before the sender recorded success. Receivers
should use the event ID as an idempotency key.

Use persistent disk storage in production. An ephemeral
hosting filesystem can lose the database after redeployment.
Run one application instance with the local SQLite database.

## Render deployment

1. Push the project to a private GitHub repository.
2. Create a Render Web Service connected to that repository.
3. Build command: npm install
4. Start command: npm start
5. Add WEBHOOK_SECRET as a secret environment variable.
6. Set DATABASE_PATH to /var/data/webhooks.sqlite.
7. Attach a persistent disk mounted at /var/data.
8. Test /health after deployment.

## Testing

Use Postman to create an event, inspect its status, and
retrieve the attempt history.

Only send webhooks to endpoints you control or have
permission to test.