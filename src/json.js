import { createHash } from "node:crypto";
import { BridgeError } from "./errors.js";

const MAX_DEPTH = 6;
const MAX_KEYS = 16;
const MAX_ARRAY = 16;

export function parseJsonStrict(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BridgeError("schema_invalid", "Body is not JSON", 400);
  }
  return freezePlain(value, 0);
}

function freezePlain(value, depth) {
  if (depth > MAX_DEPTH) {
    throw new BridgeError("schema_invalid", "JSON nesting exceeds the limit", 400);
  }
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new BridgeError("schema_invalid", "Non-finite number", 400);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) {
      throw new BridgeError("schema_invalid", "Array exceeds the limit", 400);
    }
    return value.map((item) => freezePlain(item, depth + 1));
  }
  if (t === "object") {
    const keys = Object.keys(value);
    if (keys.length > MAX_KEYS) {
      throw new BridgeError("schema_invalid", "Object has too many keys", 400);
    }
    const out = Object.create(null);
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new BridgeError("schema_invalid", "Forbidden key", 400);
      }
      out[key] = freezePlain(value[key], depth + 1);
    }
    return out;
  }
  throw new BridgeError("schema_invalid", "Unsupported JSON type", 400);
}

export function canonicalJson(value) {
  return Buffer.from(stableStringify(value), "utf8");
}

function stableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new BridgeError("schema_invalid", "Non-finite number", 400);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  throw new BridgeError("schema_invalid", "Unsupported value", 400);
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
