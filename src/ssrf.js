import { isIP } from "node:net";
import { BridgeError } from "./errors.js";

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".invalid",
  ".example",
  ".test",
  ".onion",
];
const BLOCKED_EXACT = new Set([
  "localhost",
  "metadata",
  "metadata.google",
  "metadata.google.internal",
  "example.com",
  "example.org",
  "example.net",
]);

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

function inCidr(ipInt, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

const V4_BLOCKS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPublicV4(ip) {
  const value = ipv4ToInt(ip);
  if (value == null) return false;
  for (const [base, bits] of V4_BLOCKS) {
    if (inCidr(value, ipv4ToInt(base), bits)) return false;
  }
  return true;
}

function parseIPv6(input) {
  let text = String(input).trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  if (text.length === 0 || text.includes("%") || text.includes(":::")) return null;
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!isPublicV4(dotted[2]) && ipv4ToInt(dotted[2]) == null) return null;
    if (ipv4ToInt(dotted[2]) == null) return null;
    const nums = dotted[2].split(".").map((part) => Number(part));
    const hi = ((nums[0] << 8) | nums[1]) >>> 0;
    const lo = ((nums[2] << 8) | nums[3]) >>> 0;
    text = `${dotted[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side) => {
    if (side === "") return [];
    const out = [];
    for (const part of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parseSide(halves[1]);
  if (!right) return null;
  if (left.length + right.length > 7) return null;
  const zeros = Array(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

export function formatIPv6(hextets) {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (hextets[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && hextets[j] === 0) j += 1;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const parts = hextets.map((part) => part.toString(16));
  if (bestLen < 2) return parts.join(":");
  const left = parts.slice(0, bestStart).join(":");
  const right = parts.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

function embeddedV4(hextets, offset) {
  const hi = hextets[offset];
  const lo = hextets[offset + 1];
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPublicHextets(hextets) {
  if (hextets.every((part) => part === 0)) return false;
  if (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) return false;
  if (hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff) {
    return isPublicV4(embeddedV4(hextets, 6));
  }
  if (hextets.slice(0, 6).every((part) => part === 0)) return false;
  const first = hextets[0];
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  if ((first & 0xffc0) === 0xfec0) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x2002) return false;
  if (first === 0x2001 && hextets[1] === 0x0db8) return false;
  if (first === 0x2001 && hextets[1] === 0) return false;
  if (first === 0x2001 && hextets[1] === 0x0002) return false;
  if (first === 0x2001 && (hextets[1] & 0xfff0) === 0x0020) return false;
  if (first === 0x0100 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0) return false;
  if (first === 0x0064 && hextets[1] === 0xff9b) {
    if (hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0) {
      return isPublicV4(embeddedV4(hextets, 6));
    }
    return false;
  }
  return true;
}

export function isPublicIp(ip) {
  if (typeof ip !== "string") return false;
  const normalized = ip.trim().toLowerCase();
  if (normalized.includes(":")) {
    const hextets = parseIPv6(normalized);
    return hextets != null && isPublicHextets(hextets);
  }
  return isPublicV4(normalized);
}

export function assertSafeDestination(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new BridgeError("ssrf_blocked", "Destination URL is invalid", 400);
  }
  if (url.username || url.password) {
    throw new BridgeError("ssrf_blocked", "Destination URL must not include credentials", 400);
  }
  if (url.protocol !== "https:") {
    throw new BridgeError("ssrf_blocked", "Destination must be https", 400);
  }
  if (url.port && url.port !== "443") {
    throw new BridgeError("ssrf_blocked", "Destination port is not allowed", 400);
  }
  if (url.search || url.hash) {
    throw new BridgeError("ssrf_blocked", "Destination must not include a query or fragment", 400);
  }
  const rawHost = url.hostname.replace(/\.$/, "").toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, "");
  if (host.length === 0 || host.includes("0x") || /^\d+$/.test(host)) {
    throw new BridgeError("ssrf_blocked", "Destination host is not allowed", 400);
  }
  if (host.includes(":") || isIP(host) === 6) {
    const hextets = parseIPv6(host);
    if (!hextets || !isPublicHextets(hextets)) {
      throw new BridgeError("ssrf_blocked", "Destination IP is not public", 400);
    }
    const path = url.pathname || "/";
    return `https://[${formatIPv6(hextets)}]${path}`;
  }
  if (isIP(host) === 4) {
    if (!isPublicV4(host)) {
      throw new BridgeError("ssrf_blocked", "Destination IP is not public", 400);
    }
  } else {
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || !/[a-z]/.test(host)) {
      throw new BridgeError("ssrf_blocked", "Destination host is not allowed", 400);
    }
    if (BLOCKED_EXACT.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      throw new BridgeError("ssrf_blocked", "Destination host is blocked", 400);
    }
  }
  const path = url.pathname || "/";
  return `https://${host}${path}`;
}

export function assertPublicAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new BridgeError("dns_check_required", "Public address check is required", 400);
  }
  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw new BridgeError("ssrf_blocked", "Resolved address is not public", 400);
    }
  }
  return addresses.map((address) => (String(address).includes(":") ? formatIPv6(parseIPv6(address)) : address));
}
