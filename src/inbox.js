import { parseJsonStrict, sha256 } from "./json.js";
import { BridgeError } from "./errors.js";
import { validateCallback } from "./schema.js";
import { verifyStandardWebhook } from "./sign.js";

function failure(code, httpStatus) {
  return { ok: false, code, httpStatus };
}

function hasAuthHeaders(headers) {
  if (headers == null || typeof headers !== "object") return false;
  const names = new Set(Object.keys(headers).map((key) => key.toLowerCase()));
  return names.has("webhook-id") && names.has("webhook-timestamp") && names.has("webhook-signature");
}

export function createInbox({ config, logger, clock, state }) {
  function receive({ rawBody, headers }) {
    const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
    const byteLength = buf.length;
    if (!config.callbackAuthConfigured || !config.callbackSecret) {
      logger.log({
        event: "callback_rejected",
        code: "callback_auth_unconfigured",
        httpStatus: 503,
        byte_length: byteLength,
      });
      return failure("callback_auth_unconfigured", 503);
    }
    if (!hasAuthHeaders(headers)) {
      logger.log({
        event: "callback_rejected",
        code: "auth_failed",
        httpStatus: 401,
        byte_length: byteLength,
      });
      return failure("auth_failed", 401);
    }
    if (byteLength > config.maxBodyBytes) {
      logger.log({
        event: "callback_rejected",
        code: "size_limit",
        httpStatus: 413,
        byte_length: byteLength,
      });
      return failure("size_limit", 413);
    }
    const verified = verifyStandardWebhook({
      rawBody: buf,
      headers,
      secret: config.callbackSecret,
      nowMs: clock.now(),
      toleranceSec: config.timestampToleranceSec,
    });
    if (!verified.ok) {
      logger.log({
        event: "callback_rejected",
        code: verified.code,
        httpStatus: verified.httpStatus,
        byte_length: byteLength,
      });
      return failure(verified.code, verified.httpStatus);
    }
    let callback;
    try {
      const parsed = parseJsonStrict(buf.toString("utf8"));
      callback = validateCallback(parsed, { maxHops: config.maxHops });
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : "schema_invalid";
      const httpStatus = error instanceof BridgeError ? error.httpStatus : 400;
      logger.log({ event: "callback_rejected", code, httpStatus, byte_length: byteLength });
      return failure(code, httpStatus);
    }
    if (callback.event_id !== verified.webhookId) {
      logger.log({
        event: "callback_rejected",
        code: "id_mismatch",
        httpStatus: 400,
        byte_length: byteLength,
      });
      return failure("id_mismatch", 400);
    }
    const hash = sha256(buf);
    const existing = state.events.get(callback.event_id);
    if (existing) {
      if (existing.payload_sha256 !== hash) {
        logger.log({
          event: "callback_rejected",
          code: "idempotency_conflict",
          httpStatus: 409,
          byte_length: byteLength,
          event_id: callback.event_id,
          correlation_id: callback.correlation_id,
        });
        return failure("idempotency_conflict", 409);
      }
      logger.log({
        event: "callback_duplicate",
        code: "duplicate",
        httpStatus: 200,
        byte_length: byteLength,
        event_id: callback.event_id,
        correlation_id: callback.correlation_id,
        hop: callback.hop,
        duplicate: true,
      });
      return {
        ok: true,
        duplicate: true,
        httpStatus: 200,
        event_id: callback.event_id,
        correlation_id: callback.correlation_id,
        hop: callback.hop,
      };
    }
    const pending = state.pending.get(callback.correlation_id);
    if (!pending) {
      logger.log({
        event: "callback_rejected",
        code: "unknown_correlation",
        httpStatus: 404,
        byte_length: byteLength,
        correlation_id: callback.correlation_id,
      });
      return failure("unknown_correlation", 404);
    }
    if (clock.now() > pending.expires_at_ms) {
      state.pending.delete(callback.correlation_id);
      logger.log({
        event: "callback_rejected",
        code: "correlation_expired",
        httpStatus: 408,
        byte_length: byteLength,
        correlation_id: callback.correlation_id,
      });
      return failure("correlation_expired", 408);
    }
    if (pending.status === "settled") {
      logger.log({
        event: "callback_rejected",
        code: "correlation_already_settled",
        httpStatus: 409,
        byte_length: byteLength,
        correlation_id: callback.correlation_id,
      });
      return failure("correlation_already_settled", 409);
    }
    if (state.order.length >= config.maxEvents) {
      logger.log({
        event: "callback_rejected",
        code: "inbox_full",
        httpStatus: 429,
        byte_length: byteLength,
      });
      return failure("inbox_full", 429);
    }
    const record = {
      event_id: callback.event_id,
      correlation_id: callback.correlation_id,
      hop: callback.hop,
      payload_sha256: hash,
      byte_length: byteLength,
      result_status: callback.result.status,
      result_summary: callback.result.summary,
      received_at_ms: clock.now(),
    };
    state.events.set(record.event_id, record);
    state.order.push(record.event_id);
    pending.status = "settled";
    pending.event_id = record.event_id;
    logger.log({
      event: "callback_stored",
      code: "stored",
      httpStatus: 202,
      byte_length: byteLength,
      event_id: record.event_id,
      correlation_id: record.correlation_id,
      hop: record.hop,
      duplicate: false,
    });
    return {
      ok: true,
      duplicate: false,
      httpStatus: 202,
      event_id: record.event_id,
      correlation_id: record.correlation_id,
      hop: record.hop,
    };
  }

  function list({ limit = 20, correlation_id = undefined } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, code: "schema_invalid", httpStatus: 400, events: [] };
    }
    if (correlation_id !== undefined && typeof correlation_id !== "string") {
      return { ok: false, code: "schema_invalid", httpStatus: 400, events: [] };
    }
    const events = [];
    for (let i = state.order.length - 1; i >= 0 && events.length < limit; i -= 1) {
      const record = state.events.get(state.order[i]);
      if (correlation_id && record.correlation_id !== correlation_id) continue;
      events.push({
        event_id: record.event_id,
        correlation_id: record.correlation_id,
        hop: record.hop,
        result_status: record.result_status,
        byte_length: record.byte_length,
        received_at_ms: record.received_at_ms,
      });
    }
    return { ok: true, events };
  }

  function read(eventId) {
    if (typeof eventId !== "string") {
      return { ok: false, code: "schema_invalid", httpStatus: 400 };
    }
    const record = state.events.get(eventId);
    if (!record) return { ok: false, code: "not_found", httpStatus: 404 };
    return {
      ok: true,
      event: {
        event_id: record.event_id,
        correlation_id: record.correlation_id,
        hop: record.hop,
        result_status: record.result_status,
        result_summary: record.result_summary,
        payload_sha256: record.payload_sha256,
        byte_length: record.byte_length,
        received_at_ms: record.received_at_ms,
      },
    };
  }

  return { receive, list, read };
}
