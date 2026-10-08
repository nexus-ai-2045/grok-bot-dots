import { randomUUID } from "node:crypto";
import { createBridge } from "../src/index.js";
import { canonicalJson } from "../src/json.js";
import { signStandardWebhook } from "../src/sign.js";

export function fixtureSecret() {
  return "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
}

export function createAuthedBridge(overrides = {}) {
  const secret = overrides.secret ?? fixtureSecret();
  const logs = overrides.logs ?? [];
  const inbox = {
    configured: true,
    shared_secret: secret,
  };
  if (overrides.maxBodyBytes != null) inbox.max_body_bytes = overrides.maxBodyBytes;
  if (overrides.maxHops != null) inbox.max_hops = overrides.maxHops;
  if (overrides.tolerance != null) inbox.timestamp_tolerance_seconds = overrides.tolerance;
  if (overrides.maxEvents != null) inbox.max_events = overrides.maxEvents;
  if (overrides.maxPending != null) inbox.max_pending = overrides.maxPending;
  const bridge = createBridge({
    config: {
      mode: overrides.mode ?? "mock",
      callback_inbox: inbox,
      grok_bot_routine_webhook: overrides.grok,
    },
    clock: overrides.clock,
    transport: overrides.transport,
    lookup: overrides.lookup,
    logs,
  });
  return bridge;
}

export function signedCallback({
  secret = fixtureSecret(),
  nowMs = Date.now(),
  correlationId = randomUUID(),
  eventId = randomUUID(),
  hop = 1,
  summary = "ok-result",
  timestampSec,
  body,
}) {
  const raw =
    body ??
    canonicalJson({
      schema: "grokbot_dot_bridge.callback.v1",
      event_id: eventId,
      correlation_id: correlationId,
      hop,
      result: { status: "accepted", summary },
    });
  const signed = signStandardWebhook({
    rawBody: raw,
    secret,
    webhookId: eventId,
    timestampSec: timestampSec ?? Math.floor(nowMs / 1000),
  });
  return { raw, headers: signed.headers, eventId };
}

export const SAFE_DESTINATION = "https://hooks.contoso.com/routine";

export function configuredGrok(overrides = {}) {
  return {
    configured: true,
    auth_scheme: "standard_webhooks",
    allow_unverified_scheme: false,
    endpoint: SAFE_DESTINATION,
    auth_secret: fixtureSecret(),
    timeout_ms: 5_000,
    ...overrides,
  };
}
