
const dns = require("node:dns").promises;
const net = require("node:net");
const ipaddr = require("ipaddr.js");

async function isSafeWebhookUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Require HTTPS and reject embedded credentials.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return false;
  }

  // Check literal IP addresses.
  if (net.isIP(hostname)) {
    return isPublicIp(hostname);
  }

  // Resolve the hostname and reject private/internal addresses.
  try {
    const addresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true
    });

    if (addresses.length === 0) return false;

    return addresses.every(({ address }) =>
      isPublicIp(address)
    );
  } catch {
    return false;
  }
}

function isPublicIp(address) {
  const parsed = ipaddr.parse(address);

  // Only globally routable unicast addresses are accepted.
  return parsed.range() === "unicast";
}

module.exports = { isSafeWebhookUrl };
