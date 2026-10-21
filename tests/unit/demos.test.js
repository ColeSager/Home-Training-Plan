import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(new URL("../../data/plan.json", import.meta.url), "utf8"));
const { movements } = JSON.parse(readFileSync(new URL("../../data/demos.json", import.meta.url), "utf8"));
const byName = new Map(movements.map((m) => [m.name, m]));
const pieces = plan.groups.flatMap((g) => g.sessions.flatMap((s) => s.pieces.map((p) => ({ n: s.n, ...p }))));

test("every piece lists its movements", () => {
  for (const p of pieces) assert.ok(Array.isArray(p.movements), `session ${p.n} ${p.type}`);
});

test("every piece movement exists in demos.json", () => {
  for (const p of pieces) {
    for (const m of p.movements) assert.ok(byName.has(m), `session ${p.n} ${p.type}: ${m}`);
  }
});

test("every embed keeps the unlisted hash from its url", () => {
  for (const m of movements.filter((x) => x.url)) {
    const [, id, hash] = m.url.match(/^https:\/\/vimeo\.com\/(\d+)\/([0-9a-f]+)$/);
    assert.equal(m.embed, `https://player.vimeo.com/video/${id}?h=${hash}`, m.name);
  }
});

test("movements without a video have no embed or title", () => {
  for (const m of movements.filter((x) => !x.url)) assert.equal(m.embed ?? m.title ?? null, null, m.name);
});
