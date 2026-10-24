import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signStandardWebhook, verifyStandardWebhook } from "../src/sign.js";
import { fixtureSecret } from "./helpers.js";

test("Standard Webhooks の署名バイト列は仕様どおり", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = fixtureSecret();
  assert.equal(secret, "whsec_" + key.toString("base64"));
  const id = "evt_12345678";
  const ts = "1700000000";
  const body = Buffer.from('{"ok":true}');
  const mac = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${id}.${ts}.`), body]))
    .digest("base64");
  const signed = signStandardWebhook({
    rawBody: body,
    secret,
    webhookId: id,
    timestampSec: ts,
  });
  assert.equal(signed.headers["webhook-id"], id);
  assert.equal(signed.headers["webhook-timestamp"], ts);
  assert.equal(signed.headers["content-type"], "application/json");
  assert.equal(signed.headers["webhook-signature"], `v1,${mac}`);
  const ok = verifyStandardWebhook({
    rawBody: body,
    headers: signed.headers,
    secret,
    nowMs: 1_700_000_000_000,
    toleranceSec: 300,
  });
  assert.equal(ok.ok, true);
  const changed = verifyStandardWebhook({
    rawBody: Buffer.from('{"ok":false}'),
    headers: signed.headers,
    secret,
    nowMs: 1_700_000_000_000,
    toleranceSec: 300,
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "auth_failed");
});
