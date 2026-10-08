import { BridgeError } from "./errors.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function exactKeys(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(obj, key))) {
    throw new BridgeError("schema_invalid", "Unexpected or missing fields", 400);
  }
}

function plainString(value, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new BridgeError("schema_invalid", "Invalid string field", 400);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new BridgeError("schema_invalid", "Control characters are not allowed", 400);
  }
  return value;
}

export function validateOutboundInput(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new BridgeError("schema_invalid", "Outbound input must be an object", 400);
  }
  exactKeys(input, ["instruction", "payload"]);
  const instruction = plainString(input.instruction, 1000);
  const payload = input.payload;
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BridgeError("schema_invalid", "Payload must be an object", 400);
  }
  const keys = Object.keys(payload);
  if (keys.length > 8) {
    throw new BridgeError("schema_invalid", "Payload has too many keys", 400);
  }
  const clean = Object.create(null);
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
      throw new BridgeError("schema_invalid", "Invalid payload key", 400);
    }
    const value = payload[key];
    if (typeof value === "string") clean[key] = plainString(value, 200);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean") clean[key] = value;
    else throw new BridgeError("schema_invalid", "Invalid payload value", 400);
  }
  return { instruction, payload: clean };
}

export function validateCallback(value, { maxHops }) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError("schema_invalid", "Callback must be an object", 400);
  }
  exactKeys(value, ["schema", "event_id", "correlation_id", "hop", "result"]);
  if (value.schema !== "grokbot_dot_bridge.callback.v1") {
    throw new BridgeError("schema_invalid", "Unknown callback schema", 400);
  }
  if (typeof value.event_id !== "string" || !EVENT_ID_RE.test(value.event_id)) {
    throw new BridgeError("schema_invalid", "Invalid event_id", 400);
  }
  if (!isUuid(value.correlation_id)) {
    throw new BridgeError("schema_invalid", "Invalid correlation_id", 400);
  }
  if (!Number.isInteger(value.hop) || value.hop < 1 || value.hop > maxHops) {
    throw new BridgeError("hop_limit", "Hop is outside the allowed range", 400);
  }
  const result = value.result;
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    throw new BridgeError("schema_invalid", "Invalid result", 400);
  }
  exactKeys(result, ["status", "summary"]);
  if (result.status !== "accepted" && result.status !== "failed") {
    throw new BridgeError("schema_invalid", "Invalid result status", 400);
  }
  const summary = plainString(result.summary, 500);
  return {
    schema: value.schema,
    event_id: value.event_id,
    correlation_id: value.correlation_id,
    hop: value.hop,
    result: { status: result.status, summary },
  };
}
