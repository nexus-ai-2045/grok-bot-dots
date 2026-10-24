import { randomBytes } from "node:crypto";
import { createBridge } from "../src/index.js";

// プロセス内だけで作る試験用の鍵。ファイルには書かない。資格情報ではない。
const ephemeral = "whsec_" + randomBytes(32).toString("base64");

const bridge = createBridge({
  config: { mode: "mock" },
  enableMockAuth: true,
  mockCallbackSecret: ephemeral,
});

const result = await bridge.runMockRoundTrip({
  instruction: "ローカルモックのみ。Grok Bot には送らない",
  payload: { ticket: "LOCAL-1" },
});

const summary = {
  ok: result.ok,
  network: false,
  external_network: false,
  grok_bot_contacted: false,
  mode: "mock",
  correlation_id: result.correlation_id ?? null,
  event_id: result.event_id ?? null,
  inbox_status: result.read?.event?.result_status ?? null,
  inbox_summary: result.read?.event?.result_summary ?? null,
  listed: result.list?.events?.length ?? 0,
  dot: result.dot ?? bridge.dot.describe(),
};

process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exit(result.ok ? 0 : 1);
