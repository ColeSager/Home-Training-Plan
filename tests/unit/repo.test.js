import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const DASHES = /[\u2013\u2014]/;

test("plan.json has no em or en dashes", () => {
  assert.ok(!DASHES.test(read("data/plan.json")));
});

test("plan.json sessions are numbered 1 to 36 in order with three pieces each", () => {
  const plan = JSON.parse(read("data/plan.json"));
  const ns = plan.groups.flatMap((g) => g.sessions.map((s) => s.n));
  assert.deepEqual(ns, Array.from({ length: 36 }, (_, i) => i + 1));
  for (const g of plan.groups) {
    for (const s of g.sessions) {
      assert.deepEqual(s.pieces.map((p) => p.type), ["warmup", "strength", "conditioning"], `session ${s.n}`);
    }
  }
});

test("source files have no em or en dashes", () => {
  const skip = new Set(["node_modules", ".git", "test-results", "playwright-report", "fonts", "icons"]);
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      if (skip.has(name)) return [];
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(root).filter((p) => /\.(js|html|css|json|md|webmanifest)$/.test(p))) {
    if (file.endsWith("package-lock.json")) continue;
    assert.ok(!DASHES.test(readFileSync(file, "utf8")), file);
  }
});

test("every file the service worker precaches exists", () => {
  const sw = read("sw.js");
  const list = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  const files = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== "./");
  const fresh = [...sw.match(/const NETWORK_FIRST = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(fresh, ["data/plan.json", "data/demos.json"]);
  assert.ok(sw.includes("...NETWORK_FIRST,"));
  assert.ok(files.length > 10);
  for (const f of [...files, ...fresh]) assert.ok(existsSync(join(root, f)), f);
});

test("every font the stylesheet loads is precached", () => {
  const css = read("styles.css");
  const sw = read("sw.js");
  for (const [, f] of css.matchAll(/url\("(fonts\/[^"]+)"\)/g)) {
    assert.ok(existsSync(join(root, f)), f);
    assert.ok(sw.includes(`"${f}"`), `${f} not precached`);
  }
});
