import assert from "node:assert/strict";
import test from "node:test";
import { createAuthedBridge, configuredGrok, fixtureSecret, SAFE_DESTINATION, signedCallback } from "./helpers.js";

test("相関 ID の期限を過ぎたコールバックは 408", () => {
  let now = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => now } });
  const submitted = bridge.outbound.submit({
    instruction: "expires",
    payload: { n: 1 },
  });
  now += bridge.config.timeoutMs + 1;
  const packed = signedCallback({
    nowMs: now,
    correlationId: submitted.correlation_id,
    summary: "late",
  });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "correlation_expired");
  assert.equal(result.httpStatus, 408);
  assert.equal(bridge.inbox.list().events.length, 0);
});

test("signal を無視する 120ms 応答は 50ms で timeout になり、遅い成功は採用しない", async () => {
  let settled = false;
  const transport = (_request, { signal }) =>
    new Promise((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve({ status: 202 });
      }, 120);
      signal.addEventListener("abort", () => {});
    });
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({ timeout_ms: 50 }),
    transport,
    lookup: async () => ["1.1.1.1"],
  });
  const started = Date.now();
  const result = await bridge.outbound.dispatch({
    instruction: "ignore-signal",
    payload: { n: 1 },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.code, "timeout");
  assert.equal(result.httpStatus, 504);
  assert.equal(result.ok, false);
  assert.equal(result.transport_invoked, true);
  assert.equal(result.grok_bot_contacted, "unknown");
  assert.equal(result.external_network, "unknown");
  assert.equal(settled, false);
  assert.ok(elapsed < 110, `elapsed ${elapsed}`);
});

test("signal を無視する遅い lookup も deadline で timeout になり transport は呼ばない", async () => {
  let transports = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({ timeout_ms: 50 }),
    lookup: () => new Promise((resolve) => setTimeout(() => resolve(["1.1.1.1"]), 120)),
    transport: () => {
      transports += 1;
      return { status: 202 };
    },
  });
  const started = Date.now();
  const result = await bridge.outbound.dispatch({
    instruction: "slow-lookup",
    payload: { n: 1 },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.code, "timeout");
  assert.equal(result.transport_invoked, false);
  assert.equal(result.grok_bot_contacted, false);
  assert.equal(transports, 0);
  assert.ok(elapsed < 110, `elapsed ${elapsed}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(transports, 0);
});

test("注入トランスポートが制限時間を超えると timeout になり、接触は unknown", async () => {
  const seen = [];
  const transport = (request, { signal }) =>
    new Promise((resolve, reject) => {
      seen.push({ url: request.url, redirect: request.redirect, method: request.method });
      const timer = setTimeout(() => resolve({ status: 202 }), 1_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  let lookups = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({ timeout_ms: 50 }),
    transport,
    lookup: async () => {
      lookups += 1;
      return ["1.1.1.1"];
    },
  });
  const result = await bridge.outbound.dispatch({
    instruction: "INSTRUCTION_MARKER_do_not_log",
    payload: { n: 1 },
  });
  assert.equal(result.code, "timeout");
  assert.equal(result.httpStatus, 504);
  assert.equal(result.transport_invoked, true);
  assert.equal(result.external_network, "unknown");
  assert.equal(result.grok_bot_contacted, "unknown");
  assert.equal(lookups, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, SAFE_DESTINATION);
  assert.equal(seen[0].redirect, "error");
  assert.equal(seen[0].method, "POST");
  const dumped = JSON.stringify(bridge.logs);
  assert.equal(dumped.includes("INSTRUCTION_MARKER_do_not_log"), false);
  assert.equal(dumped.includes(fixtureSecret()), false);
  assert.equal(bridge.config.timeoutMs, 50);
});

test("timeout_ms は 30000 を超えて設定できない", () => {
  const bridge = createAuthedBridge({
    mode: "mock",
    grok: configuredGrok({ timeout_ms: 999_999_999 }),
  });
  assert.equal(bridge.config.timeoutMs, 30_000);
  assert.equal(bridge.status().limits.timeout_ms, 30_000);
});
