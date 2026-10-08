import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeDestination, isPublicIp } from "../src/ssrf.js";
import { createAuthedBridge, configuredGrok, SAFE_DESTINATION } from "./helpers.js";

test("プライベートアドレスと特別用途ホストを拒否する", () => {
  const blocked = [
    "http://hooks.contoso.com/routine",
    "https://user:pass@hooks.contoso.com/routine",
    "https://127.0.0.1/routine",
    "https://169.254.169.254/latest/meta-data",
    "https://10.1.2.3/routine",
    "https://192.168.1.9/routine",
    "https://172.16.0.4/routine",
    "https://localhost/routine",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://example.invalid/routine",
    "https://2130706433/routine",
    "https://0177.0.0.1/routine",
    "https://hooks.contoso.com/routine?next=1",
    "https://hooks.contoso.com:8443/routine",
    "https://[::1]/routine",
  ];
  for (const url of blocked) {
    assert.throws(() => assertSafeDestination(url), { code: "ssrf_blocked" }, url);
  }
  assert.equal(assertSafeDestination(SAFE_DESTINATION), SAFE_DESTINATION);
});

test("公開 IP 判定", () => {
  assert.equal(isPublicIp("1.1.1.1"), true);
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("172.15.1.1"), true);
  assert.equal(isPublicIp("172.32.1.1"), true);
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("192.168.0.1"), false);
  assert.equal(isPublicIp("172.20.1.1"), false);
  assert.equal(isPublicIp("100.64.0.1"), false);
  assert.equal(isPublicIp("169.254.169.254"), false);
  assert.equal(isPublicIp("0.0.0.0"), false);
  assert.equal(isPublicIp("255.255.255.255"), false);
  assert.equal(isPublicIp("0177.0.0.1"), false);
  assert.equal(isPublicIp("::1"), false);
  assert.equal(isPublicIp("fe80::1"), false);
  assert.equal(isPublicIp("fd00::1"), false);
  assert.equal(isPublicIp("::ffff:127.0.0.1"), false);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("IPv6 は正規化して loopback / mapped-private を拒否し、公開アドレスは角括弧を残す", () => {
  assert.equal(isPublicIp("::ffff:7f00:1"), false);
  assert.equal(isPublicIp("::ffff:a00:1"), false);
  assert.equal(isPublicIp("0:0:0:0:0:0:0:1"), false);
  assert.equal(isPublicIp("::ffff:127.0.0.1"), false);
  assert.equal(isPublicIp("::ffff:10.0.0.1"), false);
  assert.equal(isPublicIp("::ffff:1.1.1.1"), true);
  assert.throws(() => assertSafeDestination("https://[::ffff:7f00:1]/routine"), { code: "ssrf_blocked" });
  assert.throws(() => assertSafeDestination("https://[::ffff:a00:1]/routine"), { code: "ssrf_blocked" });
  assert.throws(() => assertSafeDestination("https://[0:0:0:0:0:0:0:1]/routine"), { code: "ssrf_blocked" });
  assert.equal(
    assertSafeDestination("https://[2606:4700:4700:0:0:0:0:1111]/routine"),
    "https://[2606:4700:4700::1111]/routine",
  );
  assert.equal(
    assertSafeDestination("https://[2606:4700:4700::1111]/routine"),
    "https://[2606:4700:4700::1111]/routine",
  );
});

test("設定先がプライベートならトランスポートも名前解決も呼ばない", async () => {
  let lookups = 0;
  let transports = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({ endpoint: "https://169.254.169.254/latest/meta-data" }),
    lookup: async () => {
      lookups += 1;
      return ["1.1.1.1"];
    },
    transport: () => {
      transports += 1;
      return { status: 202 };
    },
  });
  assert.equal(bridge.config.mode, "refusing");
  assert.equal(bridge.config.problems.includes("ssrf_blocked"), true);
  const result = await bridge.outbound.dispatch({ instruction: "nope", payload: { n: 1 } });
  assert.equal(result.code, "ssrf_blocked");
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network, false);
  assert.equal(result.grok_bot_contacted, false);
  assert.equal(lookups, 0);
  assert.equal(transports, 0);
});

test("名前解決結果がループバックなら送らない", async () => {
  let transports = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok(),
    lookup: async () => ["127.0.0.1"],
    transport: () => {
      transports += 1;
      return { status: 202 };
    },
  });
  const result = await bridge.outbound.dispatch({ instruction: "rebind", payload: { n: 1 } });
  assert.equal(result.code, "ssrf_blocked");
  assert.equal(transports, 0);
  assert.equal(result.grok_bot_contacted, false);
});

test("呼び出し側が渡した別 URL はスキーマ違反で、名前解決しない", async () => {
  let lookups = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok(),
    lookup: async () => {
      lookups += 1;
      return ["1.1.1.1"];
    },
  });
  const result = await bridge.outbound.dispatch({
    instruction: "blocked",
    payload: { n: 1 },
    destination: "https://127.0.0.1/secret",
  });
  assert.equal(result.code, "schema_invalid");
  assert.equal(lookups, 0);
  assert.equal(result.transport_invoked, false);
});

test("未検証の bearer 方式は送らない", async () => {
  let lookups = 0;
  let transports = 0;
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok({
      auth_scheme: "bearer_unverified",
      allow_unverified_scheme: true,
    }),
    lookup: async () => {
      lookups += 1;
      return ["1.1.1.1"];
    },
    transport: () => {
      transports += 1;
      return { status: 200 };
    },
  });
  const result = await bridge.outbound.dispatch({ instruction: "bearer", payload: { n: 1 } });
  assert.equal(result.code, "scheme_unverified");
  assert.equal(result.grok_bot_contacted, false);
  assert.equal(lookups, 0);
  assert.equal(transports, 0);
});

test("トランスポート未注入のとき external_call_blocked", async () => {
  const bridge = createAuthedBridge({
    mode: "configured",
    grok: configuredGrok(),
    lookup: async () => ["1.1.1.1"],
  });
  const result = await bridge.outbound.dispatch({ instruction: "prepared-only", payload: { n: 1 } });
  assert.equal(result.code, "external_call_blocked");
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network, false);
  assert.equal(result.grok_bot_contacted, false);
});
