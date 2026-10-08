import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

test("実装にネットワーククライアントも子プロセスもない", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [...filesUnder(join(root, "src")), ...filesUnder(join(root, "scripts"))];
  const banned = [
    /\bfetch\s*\(/,
    /from\s+["']node:https["']/,
    /from\s+["']node:http["']/,
    /from\s+["']node:dns["']/,
    /child_process/,
    /undici/,
    /\bexecSync\b/,
    /\bspawn\s*\(/,
    /XAI_API_KEY/,
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
});
