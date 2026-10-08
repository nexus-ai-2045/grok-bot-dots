import { BridgeError } from "./errors.js";
import { decodeWebhookSecret } from "./sign.js";
import { assertSafeDestination } from "./ssrf.js";

export const HARD = {
  maxTimeoutMs: 30_000,
  minTimeoutMs: 50,
  maxBodyBytes: 65_536,
  minBodyBytes: 256,
  maxHops: 8,
  minHops: 1,
  maxTimestampTolerance: 300,
  minTimestampTolerance: 30,
  maxEvents: 500,
  minEvents: 1,
  maxPending: 2_000,
  minPending: 1,
};

const PLACEHOLDER_RE = /replace|placeholder|changeme|outside_repo|\btodo\b/i;

export function isPlaceholder(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (trimmed.length < 16) return true;
  return PLACEHOLDER_RE.test(trimmed);
}

function clamp(n, min, max, fallback) {
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveConfig(input = {}) {
  const warnings = [];
  const requestedMode = input.mode === "configured" ? "configured" : input.mode === "mock" || input.mode == null ? "mock" : "refusing";
  if (requestedMode === "refusing" && input.mode != null) warnings.push("unknown_mode");

  const grokIn = input.grok_bot_routine_webhook ?? {};
  const inboxIn = input.callback_inbox ?? {};
  const dotIn = input.dot_ingress ?? {};

  if (dotIn.configured === true || dotIn.endpoint != null || dotIn.automatic_wake === true) {
    warnings.push("dot_ingress_forced_unconfigured");
  }

  const timeoutMs = clamp(grokIn.timeout_ms, HARD.minTimeoutMs, HARD.maxTimeoutMs, 5_000);
  const maxBodyBytes = clamp(inboxIn.max_body_bytes, HARD.minBodyBytes, HARD.maxBodyBytes, 16_384);
  const maxHops = clamp(inboxIn.max_hops, HARD.minHops, HARD.maxHops, 3);
  const timestampToleranceSec = clamp(
    inboxIn.timestamp_tolerance_seconds,
    HARD.minTimestampTolerance,
    HARD.maxTimestampTolerance,
    300,
  );
  const maxEvents = clamp(inboxIn.max_events, HARD.minEvents, HARD.maxEvents, 100);
  const maxPending = clamp(inboxIn.max_pending, HARD.minPending, HARD.maxPending, 100);

  const callbackSecret = typeof inboxIn.shared_secret === "string" ? inboxIn.shared_secret : "";
  let callbackAuthConfigured = inboxIn.configured === true && !isPlaceholder(callbackSecret);
  if (callbackAuthConfigured) {
    try {
      decodeWebhookSecret(callbackSecret);
    } catch {
      callbackAuthConfigured = false;
      warnings.push("callback_secret_rejected");
    }
  }

  const problems = [];
  let destination = null;
  let grokSecret = null;
  const scheme = grokIn.auth_scheme ?? "unset";
  if (requestedMode === "configured" || grokIn.configured === true) {
    if (scheme === "bearer_unverified") {
      problems.push("scheme_unverified");
    } else if (scheme !== "standard_webhooks") {
      problems.push("auth_scheme_unset");
    }
    if (isPlaceholder(grokIn.auth_secret)) problems.push("grok_secret_unconfigured");
    else {
      try {
        decodeWebhookSecret(grokIn.auth_secret);
        grokSecret = grokIn.auth_secret;
      } catch {
        problems.push("grok_secret_rejected");
      }
    }
    try {
      destination = assertSafeDestination(grokIn.endpoint);
    } catch (error) {
      problems.push(error instanceof BridgeError ? error.code : "ssrf_blocked");
    }
    if (grokIn.allow_unverified_scheme === true && scheme === "bearer_unverified") {
      problems.push("unverified_scheme_refused");
    }
  }

  let mode = requestedMode;
  if (requestedMode === "configured" && problems.length > 0) mode = "refusing";
  if (requestedMode === "mock") mode = "mock";
  if (mode !== "configured") grokSecret = null;

  return {
    mode,
    requestedMode,
    problems,
    warnings,
    networkCalls: false,
    timeoutMs,
    maxBodyBytes,
    maxHops,
    timestampToleranceSec,
    maxEvents,
    maxPending,
    destination,
    grokSecret,
    authScheme: scheme,
    callbackSecret: callbackAuthConfigured ? callbackSecret : null,
    callbackAuthConfigured,
    dot: {
      configured: false,
      endpoint: null,
      automaticWake: false,
      available: false,
    },
  };
}

export function publicConfig(config) {
  return {
    mode: config.mode,
    network_calls: false,
    grok_bot_contacted: false,
    documentation: "unverified_for_grok_bot_routines",
    problems: config.problems,
    warnings: config.warnings,
    grok_bot_routine_webhook: {
      configured: config.mode === "configured" && config.problems.length === 0,
      auth_scheme: config.authScheme,
      destination_configured: config.destination != null,
    },
    callback_inbox: {
      auth_configured: config.callbackAuthConfigured,
    },
    dot_ingress: {
      configured: false,
      endpoint: null,
      automatic_wake: false,
      available: false,
    },
    limits: {
      timeout_ms: config.timeoutMs,
      max_body_bytes: config.maxBodyBytes,
      max_hops: config.maxHops,
      timestamp_tolerance_seconds: config.timestampToleranceSec,
      max_events: config.maxEvents,
      max_pending: config.maxPending,
    },
  };
}
