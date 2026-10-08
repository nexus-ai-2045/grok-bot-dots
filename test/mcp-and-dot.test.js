import assert from "node:assert/strict";
import test from "node:test";
import { createBridge } from "../src/index.js";
import { createAuthedBridge } from "./helpers.js";

test("dot ingress は設定しても未設定のまま", () => {
  const bridge = createBridge({
    config: {
      mode: "mock",
      dot_ingress: {
        configured: true,
        endpoint: "https://dot.example/wake",
        automatic_wake: true,
      },
    },
  });
  const described = bridge.dot.describe();
  assert.equal(described.configured, false);
  assert.equal(described.endpoint, null);
  assert.equal(described.automatic_wake, false);
  assert.equal(described.available, false);
  assert.equal(bridge.dot.accept().code, "dot_ingress_unconfigured");
  assert.equal(bridge.status().warnings.includes("dot_ingress_forced_unconfigured"), true);
  assert.equal(bridge.status().dot_ingress.available, false);
});

test("MCP は read/list と status だけで、dot を起こすツールはない", async () => {
  const bridge = createAuthedBridge();
  const init = bridge.mcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(init.result.serverInfo.name, "grokbot-dot-bridge");
  assert.match(init.result.instructions, /dot ingress is unconfigured/);
  const listed = bridge.mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name).sort(),
    ["bridge_status", "list_inbox", "read_inbox_event"],
  );
  const wake = bridge.mcp({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "wake_dot", arguments: {} },
  });
  assert.equal(wake.error.code, -32602);
  const round = await bridge.runMockRoundTrip({
    instruction: "mcp read",
    payload: { n: 1 },
  });
  const status = bridge.mcp({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "bridge_status", arguments: {} },
  });
  assert.equal(status.result.structured.grok_bot_contacted, false);
  assert.equal(status.result.structured.dot_ingress.automatic_wake, false);
  assert.equal(status.result.structured.stored_events, 1);
  const inbox = bridge.mcp({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "list_inbox", arguments: { limit: 10 } },
  });
  assert.equal(inbox.result.structured.events.length, 1);
  assert.equal(inbox.result.structured.events[0].correlation_id, round.correlation_id);
  const read = bridge.mcp({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "read_inbox_event", arguments: { event_id: round.event_id } },
  });
  assert.equal(read.result.structured.event.result_summary, "mock-routine-ok");
  assert.equal(read.result.isError, false);
  const missing = bridge.mcp({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "ask_grokbot", arguments: {} },
  });
  assert.equal(missing.error.code, -32602);
});
