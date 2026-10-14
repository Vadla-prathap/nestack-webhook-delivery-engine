const crypto = require("node:crypto");

function signPayload(body, secret) {
  return "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
}

function verifySignature(body, signature, secret) {
  if (typeof signature !== "string") return false;

  const expected = Buffer.from(
    signPayload(body, secret), "utf8"
  );
  const received = Buffer.from(signature, "utf8");

  return expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);
}

module.exports = { signPayload, verifySignature };