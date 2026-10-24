import assert from "node:assert/strict";
import test from "node:test";
import { createAuthedBridge, signedCallback } from "./helpers.js";

test("上限を超える本文は 413 で、本文はログに残らない", () => {
  const bridge = createAuthedBridge();
  const marker = "SIZE_MARKER_do_not_log";
  const body = Buffer.concat([
    Buffer.from(marker),
    Buffer.alloc(bridge.config.maxBodyBytes, 0x61),
  ]);
  const result = bridge.inbox.receive({
    rawBody: body,
    headers: {
      "webhook-id": "evt_size_01",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,not-a-real-signature",
    },
  });
  assert.equal(result.code, "size_limit");
  assert.equal(result.httpStatus, 413);
  assert.equal(bridge.inbox.list().events.length, 0);
  assert.equal(JSON.stringify(bridge.logs).includes(marker), false);
});

test("max_body_bytes は 65536 で頭打ちになり、その翌バイトは拒否する", () => {
  const bridge = createAuthedBridge({ maxBodyBytes: 10_000_000 });
  assert.equal(bridge.config.maxBodyBytes, 65_536);
  const body = Buffer.alloc(65_537, 0x62);
  const result = bridge.inbox.receive({
    rawBody: body,
    headers: {
      "webhook-id": "evt_size_02",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,not-a-real-signature",
    },
  });
  assert.equal(result.code, "size_limit");
  assert.equal(result.httpStatus, 413);
});

test("ホップ上限を超えるコールバックは 400", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs }, maxHops: 3 });
  const submitted = bridge.outbound.submit({ instruction: "hop", payload: { n: 1 } });
  const packed = signedCallback({
    nowMs,
    correlationId: submitted.correlation_id,
    hop: 4,
    summary: "too-far",
  });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "hop_limit");
  assert.equal(result.httpStatus, 400);
  assert.equal(bridge.inbox.list().events.length, 0);
});

test("ホップ上限ちょうどのコールバックは受け取れる", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs }, maxHops: 3 });
  const submitted = bridge.outbound.submit({ instruction: "hop-ok", payload: { n: 1 } });
  const packed = signedCallback({
    nowMs,
    correlationId: submitted.correlation_id,
    hop: 3,
    summary: "edge",
  });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.ok, true);
  assert.equal(result.hop, 3);
  assert.equal(bridge.inbox.read(result.event_id).event.hop, 3);
});

test("max_hops は 8 を超えて設定できない", () => {
  const bridge = createAuthedBridge({ maxHops: 100 });
  assert.equal(bridge.config.maxHops, 8);
  const nowMs = 1_700_000_000_000;
  const timed = createAuthedBridge({ clock: { now: () => nowMs }, maxHops: 100 });
  const submitted = timed.outbound.submit({ instruction: "clamped", payload: { n: 1 } });
  const packed = signedCallback({
    nowMs,
    correlationId: submitted.correlation_id,
    hop: 9,
    summary: "over-hard-cap",
  });
  assert.equal(timed.inbox.receive({ rawBody: packed.raw, headers: packed.headers }).code, "hop_limit");
});
