import { randomUUID } from "node:crypto";
import { publicConfig, resolveConfig } from "./config.js";
import { createDotIngress } from "./dot.js";
import { createInbox } from "./inbox.js";
import { canonicalJson } from "./json.js";
import { createLogger } from "./log.js";
import { handleMcp } from "./mcp.js";
import { createOutbound } from "./outbound.js";
import { signStandardWebhook } from "./sign.js";

export function createBridge(options = {}) {
  const config = resolveConfig(options.config ?? {});
  const logs = options.logs ?? [];
  const logger = createLogger(logs);
  const clock = options.clock ?? { now: () => Date.now() };
  const state = { pending: new Map(), events: new Map(), order: [] };
  const inbox = createInbox({ config, logger, clock, state });
  const runtime = { transportInvoked: false };
  const outbound = createOutbound({
    config,
    logger,
    clock,
    state,
    transport: options.transport,
    lookup: options.lookup,
    runtime,
  });
  const dot = createDotIngress();
  const ephemeralCallbackSecret = options.mockCallbackSecret ?? null;
  if (options.enableMockAuth === true && ephemeralCallbackSecret && config.mode === "mock") {
    config.callbackSecret = ephemeralCallbackSecret;
    config.callbackAuthConfigured = true;
  }

  function status() {
    outbound.sweepExpired();
    const view = publicConfig(config);
    view.stored_events = state.order.length;
    view.pending = state.pending.size;
    view.grok_bot_contacted = runtime.transportInvoked ? "unknown" : false;
    view.network_calls = runtime.transportInvoked ? "unknown" : false;
    return view;
  }

  function mcp(message) {
    return handleMcp(message, { inbox, status });
  }

  async function runMockRoundTrip(input) {
    if (config.mode !== "mock") {
      return { ok: false, code: "not_mock_mode", external_network: false, grok_bot_contacted: false };
    }
    if (!config.callbackAuthConfigured || !config.callbackSecret) {
      return {
        ok: false,
        code: "callback_auth_unconfigured",
        httpStatus: 503,
        external_network: false,
        grok_bot_contacted: false,
      };
    }
    const submitted = outbound.submit(input);
    if (!submitted.ok) {
      return { ...submitted, stage: "submit", grok_bot_contacted: false };
    }
    const eventId = randomUUID();
    const body = canonicalJson({
      schema: "grokbot_dot_bridge.callback.v1",
      event_id: eventId,
      correlation_id: submitted.correlation_id,
      hop: 1,
      result: { status: "accepted", summary: "mock-routine-ok" },
    });
    const signed = signStandardWebhook({
      rawBody: body,
      secret: config.callbackSecret,
      webhookId: eventId,
      timestampSec: Math.floor(clock.now() / 1000),
    });
    const received = inbox.receive({ rawBody: body, headers: signed.headers });
    if (!received.ok) {
      return { ...received, stage: "callback", external_network: false, grok_bot_contacted: false };
    }
    return {
      ok: true,
      network: false,
      external_network: false,
      grok_bot_contacted: false,
      transport_invoked: false,
      correlation_id: submitted.correlation_id,
      event_id: received.event_id,
      read: inbox.read(received.event_id),
      list: inbox.list(),
      dot: dot.describe(),
    };
  }

  return {
    config,
    logs,
    inbox,
    outbound,
    dot,
    status,
    mcp,
    runMockRoundTrip,
    publicView: status,
  };
}
