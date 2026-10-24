import assert from "node:assert/strict";
import test from "node:test";
import { createAuthedBridge, fixtureSecret } from "./helpers.js";

test("モック往復は request → callback → inbox read で、外部通信しない", async () => {
  let transportCalls = 0;
  let lookupCalls = 0;
  const bridge = createAuthedBridge({
    transport: () => {
      transportCalls += 1;
      return { status: 202 };
    },
    lookup: async () => {
      lookupCalls += 1;
      return ["1.1.1.1"];
    },
  });
  const marker = "INSTRUCTION_MARKER_do_not_log";
  const result = await bridge.runMockRoundTrip({
    instruction: marker,
    payload: { ticket: "LOCAL-1" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.external_network, false);
  assert.equal(result.grok_bot_contacted, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(transportCalls, 0);
  assert.equal(lookupCalls, 0);
  assert.equal(result.read.event.result_status, "accepted");
  assert.equal(result.read.event.result_summary, "mock-routine-ok");
  assert.equal(result.read.event.result_summary.includes(marker), false);
  assert.equal(result.list.events.length, 1);
  assert.equal(result.list.events[0].event_id, result.event_id);
  assert.equal(result.list.events[0].correlation_id, result.correlation_id);
  assert.equal(result.dot.configured, false);
  assert.equal(result.dot.automatic_wake, false);
  assert.equal(result.dot.endpoint, null);
  const dumped = JSON.stringify(bridge.logs);
  assert.equal(dumped.includes(marker), false);
  assert.equal(dumped.includes(fixtureSecret()), false);
  const dispatch = await bridge.outbound.dispatch({
    instruction: marker,
    payload: { ticket: "LOCAL-2" },
  });
  assert.equal(dispatch.code, "mock_mode_no_dispatch");
  assert.equal(transportCalls, 0);
  assert.equal(lookupCalls, 0);
});
