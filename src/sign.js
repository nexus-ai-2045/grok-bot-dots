import { createHmac, timingSafeEqual } from "node:crypto";
import { BridgeError } from "./errors.js";

const SECRET_RE = /^whsec_([A-Za-z0-9+/]{22,}={0,2})$/;

export function decodeWebhookSecret(secret) {
  if (typeof secret !== "string") {
    throw new BridgeError("callback_auth_unconfigured", "Callback secret is not set", 503);
  }
  const match = SECRET_RE.exec(secret);
  if (!match) {
    throw new BridgeError("callback_auth_unconfigured", "Callback secret format is invalid", 503);
  }
  const key = Buffer.from(match[1], "base64");
  if (key.length < 16) {
    throw new BridgeError("callback_auth_unconfigured", "Callback secret is too short", 503);
  }
  return key;
}

export function signStandardWebhook({ rawBody, secret, webhookId, timestampSec }) {
  const key = decodeWebhookSecret(secret);
  const id = String(webhookId);
  const ts = String(timestampSec);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`, "utf8"), body]);
  const digest = createHmac("sha256", key).update(signed).digest("base64");
  return {
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${digest}`,
    },
  };
}

function header(headers, name) {
  if (headers == null || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function verifyStandardWebhook({ rawBody, headers, secret, nowMs, toleranceSec }) {
  let key;
  try {
    key = decodeWebhookSecret(secret);
  } catch {
    return { ok: false, code: "callback_auth_unconfigured", httpStatus: 503 };
  }
  const webhookId = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signature = header(headers, "webhook-signature");
  if (
    typeof webhookId !== "string" ||
    typeof timestamp !== "string" ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(webhookId) ||
    !/^\d{1,12}$/.test(timestamp)
  ) {
    return { ok: false, code: "auth_failed", httpStatus: 401 };
  }
  const ts = Number(timestamp);
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) {
    return { ok: false, code: "stale_timestamp", httpStatus: 401 };
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const signed = Buffer.concat([Buffer.from(`${webhookId}.${timestamp}.`, "utf8"), body]);
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  const presented = signature.split(" ").filter((part) => part.startsWith("v1,"));
  let matched = false;
  const expectedBuf = Buffer.from(expected);
  for (const part of presented) {
    const got = part.slice(3);
    const gotBuf = Buffer.from(got);
    if (gotBuf.length === expectedBuf.length && timingSafeEqual(gotBuf, expectedBuf)) {
      matched = true;
    } else if (gotBuf.length > 0) {
      timingSafeEqual(expectedBuf, expectedBuf);
    }
  }
  if (!matched) return { ok: false, code: "auth_failed", httpStatus: 401 };
  return { ok: true, webhookId, timestampSec: ts };
}
