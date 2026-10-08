import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../src/json.js";
import { signStandardWebhook } from "../src/sign.js";
import { createAuthedBridge, fixtureSecret, signedCallback } from "./helpers.js";

test("同じ event_id と本文は重複として一度だけ保存する", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs } });
  const submitted = bridge.outbound.submit({
    instruction: "duplicate check",
    payload: { n: 1 },
  });
  const packed = signedCallback({
    nowMs,
    correlationId: submitted.correlation_id,
    summary: "once",
  });
  const first = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  const second = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.httpStatus, 202);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.httpStatus, 200);
  assert.equal(bridge.inbox.list().events.length, 1);
  assert.equal(bridge.inbox.read(first.event_id).event.result_summary, "once");
});

test("同じ event_id で本文が違うと 409", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs } });
  const submitted = bridge.outbound.submit({
    instruction: "conflict check",
    payload: { n: 2 },
  });
  const eventId = randomUUID();
  const first = signedCallback({
    nowMs,
    secret: fixtureSecret(),
    correlationId: submitted.correlation_id,
    eventId,
    summary: "first-body",
  });
  const secondRaw = canonicalJson({
    schema: "grokbot_dot_bridge.callback.v1",
    event_id: eventId,
    correlation_id: submitted.correlation_id,
    hop: 1,
    result: { status: "accepted", summary: "second-body" },
  });
  const secondSigned = signStandardWebhook({
    rawBody: secondRaw,
    secret: fixtureSecret(),
    webhookId: eventId,
    timestampSec: Math.floor(nowMs / 1000),
  });
  assert.equal(bridge.inbox.receive({ rawBody: first.raw, headers: first.headers }).ok, true);
  const conflict = bridge.inbox.receive({ rawBody: secondRaw, headers: secondSigned.headers });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "idempotency_conflict");
  assert.equal(conflict.httpStatus, 409);
  assert.equal(bridge.inbox.list().events.length, 1);
});

test("解決済み correlation への別イベントは 409", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs } });
  const submitted = bridge.outbound.submit({
    instruction: "settle once",
    payload: { n: 3 },
  });
  const first = signedCallback({ nowMs, correlationId: submitted.correlation_id, summary: "kept" });
  assert.equal(bridge.inbox.receive({ rawBody: first.raw, headers: first.headers }).ok, true);
  const second = signedCallback({ nowMs, correlationId: submitted.correlation_id, summary: "extra" });
  const result = bridge.inbox.receive({ rawBody: second.raw, headers: second.headers });
  assert.equal(result.code, "correlation_already_settled");
  assert.equal(result.httpStatus, 409);
  assert.equal(bridge.inbox.list().events.length, 1);
});
