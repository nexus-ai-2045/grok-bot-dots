import assert from "node:assert/strict";
import test from "node:test";
import { createAuthedBridge, configuredGrok, signedCallback } from "./helpers.js";

test("configured のオフライン dispatch は送信前に相関を登録し、同期 callback を読める", async () => {
  const now = 1_700_000_000_000;
  let bridge;
  const transport = (request) => {
    assert.equal(request.offline_mock, true);
    assert.equal(request.redirect, "error");
    assert.deepEqual(request.resolved_ips, ["1.1.1.1"]);
    assert.equal(typeof request.tls_servername, "string");
    const packed = signedCallback({
      nowMs: now,
      correlationId: request.correlation_id,
      summary: "sync-ok",
    });
    const received = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
    assert.equal(received.ok, true);
    assert.equal(received.duplicate, false);
    return { status: 202 };
  };
  bridge = createAuthedBridge({
    clock: { now: () => now },
    mode: "configured",
    grok: configuredGrok({ timeout_ms: 5_000 }),
    transport,
    lookup: async () => ["1.1.1.1"],
  });
  const result = await bridge.outbound.dispatch({
    instruction: "sync-callback",
    payload: { n: 1 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "transport_returned");
  assert.equal(result.grok_bot_contacted, "unknown");
  assert.equal(result.external_network, "unknown");
  const read = bridge.inbox.read(bridge.inbox.list().events[0].event_id);
  assert.equal(read.event.result_summary, "sync-ok");
  assert.equal(read.event.correlation_id, result.correlation_id);
  assert.equal(bridge.status().grok_bot_contacted, "unknown");
});

test("送信失敗は未解決の pending を消す", async () => {
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({ timeout_ms: 5_000 }),
    lookup: async () => ["1.1.1.1"],
    transport: () => {
      throw new Error("down");
    },
  });
  const result = await bridge.outbound.dispatch({
    instruction: "fail",
    payload: { n: 1 },
  });
  assert.equal(result.code, "transport_failed");
  assert.equal(result.grok_bot_contacted, "unknown");
  assert.equal(bridge.status().pending, 0);
});

test("pending は件数で拒否し、期限後に残さない", () => {
  let now = 1_700_000_000_000;
  const capped = createAuthedBridge({
    clock: { now: () => now },
    maxPending: 1,
    maxEvents: 1,
  });
  assert.equal(capped.outbound.submit({ instruction: "one", payload: { n: 1 } }).ok, true);
  assert.equal(capped.outbound.submit({ instruction: "two", payload: { n: 2 } }).code, "pending_full");
  assert.equal(capped.status().pending, 1);

  const many = createAuthedBridge({
    clock: { now: () => now },
    maxEvents: 1,
    maxPending: 1000,
  });
  for (let i = 0; i < 1000; i += 1) {
    const submitted = many.outbound.submit({ instruction: "batch", payload: { n: i % 7 } });
    assert.equal(submitted.ok, true);
  }
  assert.equal(many.status().pending, 1000);
  now += 24 * 60 * 60 * 1000;
  assert.equal(many.status().pending, 0);
  assert.equal(many.inbox.list().events.length, 0);
});
