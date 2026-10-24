import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createBridge } from "../src/index.js";
import { createAuthedBridge, fixtureSecret, signedCallback } from "./helpers.js";

const MARKER = "FORGED_BODY_MARKER_do_not_log";

test("署名のないコールバックは 401 で保存しない", () => {
  const bridge = createAuthedBridge();
  const result = bridge.inbox.receive({
    rawBody: Buffer.from(`{"note":"${MARKER}"}`),
    headers: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth_failed");
  assert.equal(result.httpStatus, 401);
  assert.equal(bridge.inbox.list().events.length, 0);
  assert.equal(JSON.stringify(bridge.logs).includes(MARKER), false);
  assert.equal(JSON.stringify(bridge.logs).includes(fixtureSecret()), false);
});

test("署名が偽のコールバックは 401", () => {
  const bridge = createAuthedBridge();
  const packed = signedCallback({
    correlationId: randomUUID(),
    summary: MARKER,
  });
  packed.headers["webhook-signature"] = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "auth_failed");
  assert.equal(result.httpStatus, 401);
  assert.equal(JSON.stringify(bridge.logs).includes(MARKER), false);
});

test("期限切れタイムスタンプは 401 stale_timestamp", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs } });
  const packed = signedCallback({
    nowMs,
    timestampSec: Math.floor(nowMs / 1000) - 301,
    correlationId: randomUUID(),
    summary: MARKER,
  });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "stale_timestamp");
  assert.equal(result.httpStatus, 401);
  assert.equal(JSON.stringify(bridge.logs).includes(MARKER), false);
});

test("正しい署名でも未知の correlation_id は 404", () => {
  const nowMs = 1_700_000_000_000;
  const bridge = createAuthedBridge({ clock: { now: () => nowMs } });
  const packed = signedCallback({ nowMs, correlationId: randomUUID(), summary: "no-match" });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "unknown_correlation");
  assert.equal(result.httpStatus, 404);
  assert.equal(bridge.inbox.list().events.length, 0);
});

test("コールバック認証が未設定なら署名があっても 503", () => {
  const bridge = createBridge({ config: { mode: "mock" } });
  const packed = signedCallback({ summary: MARKER });
  const result = bridge.inbox.receive({ rawBody: packed.raw, headers: packed.headers });
  assert.equal(result.code, "callback_auth_unconfigured");
  assert.equal(result.httpStatus, 503);
  assert.equal(JSON.stringify(bridge.logs).includes(MARKER), false);
  assert.equal(JSON.stringify(bridge.logs).includes(fixtureSecret()), false);
});
