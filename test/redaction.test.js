import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "../src/log.js";
import { fixtureSecret } from "./helpers.js";

test("ログは秘密と本文を落とす", () => {
  const sink = [];
  const logger = createLogger(sink);
  logger.log({
    event: "callback_rejected",
    code: "auth_failed",
    secret: fixtureSecret(),
    shared_secret: fixtureSecret(),
    authorization: "Bearer should-not-appear",
    rawBody: "BODY_MARKER_do_not_log",
    payload: { instruction: "INSTRUCTION_MARKER_do_not_log" },
    headers: { "webhook-signature": "v1,abcdefghijklmnop" },
    correlation_id: "11111111-1111-4111-8111-111111111111",
    byte_length: 4,
    httpStatus: 401,
  });
  const dumped = JSON.stringify(sink);
  assert.equal(dumped.includes(fixtureSecret()), false);
  assert.equal(dumped.includes("BODY_MARKER_do_not_log"), false);
  assert.equal(dumped.includes("INSTRUCTION_MARKER_do_not_log"), false);
  assert.equal(dumped.includes("Bearer"), false);
  assert.equal(dumped.includes("webhook-signature"), false);
  assert.match(dumped, /11111111-1111-4111-8111-111111111111/);
  assert.match(dumped, /"byte_length":4/);
});
