import { randomUUID } from "node:crypto";
import { BridgeError } from "./errors.js";
import { canonicalJson, sha256 } from "./json.js";
import { validateOutboundInput } from "./schema.js";
import { signStandardWebhook } from "./sign.js";
import { assertPublicAddresses, assertSafeDestination } from "./ssrf.js";

function sweepExpired(state, now) {
  for (const [id, item] of state.pending) {
    if (now > item.expires_at_ms) state.pending.delete(id);
  }
}

function countInFlight(state, now) {
  let count = 0;
  for (const item of state.pending.values()) {
    if (item.status === "pending" && now <= item.expires_at_ms) count += 1;
  }
  return count;
}

function dropIfStillPending(state, correlationId) {
  const item = state.pending.get(correlationId);
  if (item && item.status === "pending") state.pending.delete(correlationId);
}

function servername(urlString) {
  const host = new URL(urlString).hostname;
  return host.startsWith("[") ? host.slice(1, -1) : host;
}

export function createOutbound({ config, logger, clock, state, transport, lookup, runtime }) {
  function registerPending(correlationId, rawBody) {
    const now = clock.now();
    sweepExpired(state, now);
    if (countInFlight(state, now) >= config.maxPending) return false;
    state.pending.set(correlationId, {
      status: "pending",
      created_at_ms: now,
      expires_at_ms: now + config.timeoutMs,
      request_sha256: sha256(rawBody),
      byte_length: rawBody.length,
    });
    return true;
  }

  function contactFlags(transportInvoked) {
    return {
      transport_invoked: transportInvoked,
      external_network: transportInvoked ? "unknown" : false,
      grok_bot_contacted: transportInvoked ? "unknown" : false,
    };
  }

  function submit(input) {
    let clean;
    try {
      clean = validateOutboundInput(input);
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : "schema_invalid";
      logger.log({ event: "outbound_rejected", code, httpStatus: 400, mode: config.mode });
      return { ok: false, code, httpStatus: 400, ...contactFlags(false) };
    }
    const correlationId = randomUUID();
    const rawBody = canonicalJson({
      schema: "grokbot_dot_bridge.outbound.v1",
      correlation_id: correlationId,
      hop: 0,
      instruction: clean.instruction,
      payload: clean.payload,
    });
    if (!registerPending(correlationId, rawBody)) {
      logger.log({ event: "outbound_rejected", code: "pending_full", httpStatus: 429, mode: config.mode });
      return { ok: false, code: "pending_full", httpStatus: 429, ...contactFlags(false) };
    }
    logger.log({
      event: "outbound_accepted",
      code: "pending",
      correlation_id: correlationId,
      byte_length: rawBody.length,
      hop: 0,
      mode: config.mode,
      transport_invoked: false,
    });
    return {
      ok: true,
      mode: config.mode,
      correlation_id: correlationId,
      status: "pending",
      byte_length: rawBody.length,
      request_sha256: sha256(rawBody),
      ...contactFlags(false),
    };
  }

  async function dispatch(input) {
    if (config.mode === "mock") {
      logger.log({ event: "dispatch_blocked", code: "mock_mode", mode: "mock", transport_invoked: false });
      return { ok: false, code: "mock_mode_no_dispatch", httpStatus: 409, ...contactFlags(false) };
    }
    if (config.mode !== "configured" || config.problems.length > 0) {
      const code = config.problems[0] ?? "destination_unconfigured";
      logger.log({ event: "dispatch_blocked", code, mode: config.mode, transport_invoked: false });
      return {
        ok: false,
        code,
        httpStatus: 503,
        problems: config.problems,
        ...contactFlags(false),
      };
    }
    if (config.authScheme !== "standard_webhooks") {
      logger.log({ event: "dispatch_blocked", code: "scheme_unverified", mode: config.mode, transport_invoked: false });
      return { ok: false, code: "scheme_unverified", httpStatus: 501, ...contactFlags(false) };
    }
    let clean;
    try {
      clean = validateOutboundInput(input);
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : "schema_invalid";
      logger.log({ event: "dispatch_blocked", code, transport_invoked: false });
      return { ok: false, code, httpStatus: 400, ...contactFlags(false) };
    }
    let destination;
    try {
      destination = assertSafeDestination(config.destination);
    } catch (error) {
      const code = error instanceof BridgeError ? error.code : "ssrf_blocked";
      logger.log({ event: "dispatch_blocked", code, transport_invoked: false });
      return { ok: false, code, httpStatus: 400, ...contactFlags(false) };
    }
    if (typeof lookup !== "function") {
      logger.log({ event: "dispatch_blocked", code: "dns_check_required", transport_invoked: false });
      return { ok: false, code: "dns_check_required", httpStatus: 400, ...contactFlags(false) };
    }

    const controller = new AbortController();
    let deadlineFired = false;
    let transportStarted = false;
    let correlationId = null;
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        deadlineFired = true;
        controller.abort();
        resolve({ deadline: true });
      }, config.timeoutMs);
    });
    const work = (async () => {
      let addresses;
      try {
        addresses = assertPublicAddresses(await lookup(destination, { signal: controller.signal }));
      } catch (error) {
        const code = error instanceof BridgeError ? error.code : "ssrf_blocked";
        return { ok: false, code, httpStatus: 400, ...contactFlags(false) };
      }
      if (deadlineFired) return { ok: false, code: "timeout", httpStatus: 504, ...contactFlags(false) };
      correlationId = randomUUID();
      const rawBody = canonicalJson({
        schema: "grokbot_dot_bridge.outbound.v1",
        correlation_id: correlationId,
        hop: 0,
        instruction: clean.instruction,
        payload: clean.payload,
      });
      if (!registerPending(correlationId, rawBody)) {
        return { ok: false, code: "pending_full", httpStatus: 429, correlation_id: correlationId, ...contactFlags(false) };
      }
      if (deadlineFired) {
        dropIfStillPending(state, correlationId);
        return { ok: false, code: "timeout", httpStatus: 504, correlation_id: correlationId, ...contactFlags(false) };
      }
      const signed = signStandardWebhook({
        rawBody,
        secret: config.grokSecret,
        webhookId: correlationId,
        timestampSec: Math.floor(clock.now() / 1000),
      });
      if (typeof transport !== "function") {
        dropIfStillPending(state, correlationId);
        logger.log({
          event: "dispatch_blocked",
          code: "external_call_blocked",
          correlation_id: correlationId,
          byte_length: rawBody.length,
          transport_invoked: false,
        });
        return {
          ok: false,
          code: "external_call_blocked",
          httpStatus: 503,
          correlation_id: correlationId,
          byte_length: rawBody.length,
          ...contactFlags(false),
        };
      }
      transportStarted = true;
      if (runtime) runtime.transportInvoked = true;
      let result;
      try {
        result = await transport(
          {
            url: destination,
            method: "POST",
            headers: signed.headers,
            body: rawBody,
            redirect: "error",
            correlation_id: correlationId,
            resolved_ips: addresses,
            tls_servername: servername(destination),
            offline_mock: true,
          },
          { signal: controller.signal },
        );
      } catch (error) {
        if (deadlineFired || controller.signal.aborted || error?.name === "AbortError") {
          dropIfStillPending(state, correlationId);
          return { ok: false, code: "timeout", httpStatus: 504, correlation_id: correlationId, ...contactFlags(true) };
        }
        dropIfStillPending(state, correlationId);
        logger.log({
          event: "dispatch_failed",
          code: "transport_failed",
          correlation_id: correlationId,
          byte_length: rawBody.length,
          transport_invoked: true,
        });
        return { ok: false, code: "transport_failed", httpStatus: 502, correlation_id: correlationId, ...contactFlags(true) };
      }
      if (deadlineFired || controller.signal.aborted) {
        dropIfStillPending(state, correlationId);
        return { ok: false, code: "timeout", httpStatus: 504, correlation_id: correlationId, ...contactFlags(true) };
      }
      logger.log({
        event: "dispatch_transport_returned",
        code: "transport_returned",
        correlation_id: correlationId,
        byte_length: rawBody.length,
        transport_invoked: true,
      });
      return {
        ok: true,
        code: "transport_returned",
        correlation_id: correlationId,
        transport_status: result && typeof result.status === "number" ? result.status : null,
        ...contactFlags(true),
      };
    })();

    const raced = await Promise.race([
      deadline,
      work.then((value) => ({ deadline: false, value })).catch(() => ({ deadline: false, failed: true })),
    ]);
    clearTimeout(timer);
    if (raced.deadline || deadlineFired) {
      if (correlationId) dropIfStillPending(state, correlationId);
      logger.log({
        event: "dispatch_failed",
        code: "timeout",
        correlation_id: correlationId ?? undefined,
        transport_invoked: transportStarted,
      });
      return {
        ok: false,
        code: "timeout",
        httpStatus: 504,
        correlation_id: correlationId ?? undefined,
        ...contactFlags(transportStarted),
      };
    }
    if (raced.failed) {
      if (correlationId) dropIfStillPending(state, correlationId);
      return { ok: false, code: "transport_failed", httpStatus: 502, ...contactFlags(transportStarted) };
    }
    return raced.value;
  }

  return { submit, dispatch, sweepExpired: () => sweepExpired(state, clock.now()) };
}
