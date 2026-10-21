import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateMax, barLoad, dbLoad, pieceLoads, resolveEstimate, changeSince } from "../../calc.js";

const plan = JSON.parse(readFileSync(new URL("../../data/plan.json", import.meta.url), "utf8"));
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/calc_fixtures.json", import.meta.url), "utf8"));
const sessions = new Map(plan.groups.flatMap((g) => g.sessions).map((s) => [s.n, s]));
const strengthApp = (n) => sessions.get(n).pieces.find((p) => p.type === "strength").app;
const BAR = plan.equipment.bar_loads_lb;

test("estimate is weight x (1 + reps / 30), rounded half up", () => {
  assert.equal(estimateMax(135, 7), 167);
  assert.equal(estimateMax(45, 7), 56);
  assert.equal(estimateMax(25, 8), 32);
  assert.equal(estimateMax(95, 8), 120);
  assert.equal(estimateMax(30, 0), 30);
});

test("barbell fixed-rep lines round down to a loadable weight", () => {
  assert.equal(barLoad(100, 0.85, false, BAR), 75);
  assert.equal(barLoad(200, 0.8, false, BAR), 145);
  assert.equal(barLoad(100, 0.75, false, BAR), 75);
});

test("barbell max-rep lines round to a whole pound, then take the nearest load, ties go lower", () => {
  assert.equal(barLoad(167, 0.78, true, BAR), 125);
  assert.equal(barLoad(167, 0.85, true, BAR), 145);
  assert.equal(barLoad(100, 0.85, true, BAR), 75);
  assert.equal(barLoad(200, 0.775, true, BAR), 145);
  assert.equal(barLoad(100, 0.9, true, BAR), 95);
});

test("barbell loads stay between 45 and 195", () => {
  assert.equal(barLoad(50, 0.65, false, BAR), 45);
  assert.equal(barLoad(50, 0.65, true, BAR), 45);
  assert.equal(barLoad(400, 0.8, false, BAR), 195);
  assert.equal(barLoad(400, 0.8, true, BAR), 195);
});

test("barbell never lands on an impossible load", () => {
  for (let est = 45; est <= 320; est++) {
    for (const pct of [0.65, 0.7, 0.72, 0.75, 0.78, 0.8, 0.83, 0.85]) {
      for (const max of [true, false]) assert.ok(BAR.includes(barLoad(est, pct, max, BAR)));
    }
  }
});

test("dumbbell max-rep lines round to the nearest 5, half up", () => {
  assert.equal(dbLoad(50, 0.75, true, 5), 40);
  assert.equal(dbLoad(56, 0.75, true, 5), 40);
  assert.equal(dbLoad(60, 0.7, true, 5), 40);
});

test("dumbbell fixed-rep lines round down to 5, never below 5", () => {
  assert.equal(dbLoad(56, 0.7, false, 5), 35);
  assert.equal(dbLoad(60, 0.75, false, 5), 45);
  assert.equal(dbLoad(5, 0.5, false, 5), 5);
  assert.equal(dbLoad(5, 0.5, true, 5), 5);
});

for (const [i, f] of fixtures.entries()) {
  test(`fixture ${i + 1}: ${f.kind} ${f.test_weight} x ${f.test_reps}`, () => {
    assert.equal(estimateMax(f.test_weight, f.test_reps), f.estimated_max);
    for (const [n, expected] of Object.entries(f.sessions)) {
      const app = strengthApp(Number(n));
      assert.equal(app.load_kind, f.kind, `session ${n} load kind`);
      assert.deepEqual(pieceLoads(app, f.estimated_max, plan.equipment), expected, `session ${n}`);
    }
  });
}

test("a missing test falls back to the most recent earlier test", () => {
  const at = { 8: 56, 20: null };
  assert.deepEqual(resolveEstimate([8, 20, 35], 20, (n) => at[n] ?? null), { n: 8, value: 56 });
  assert.deepEqual(resolveEstimate([9, 19, 36], 19, (n) => ({ 9: 120, 19: 130 })[n] ?? null), { n: 19, value: 130 });
  assert.equal(resolveEstimate([7, 29, 34], 29, () => null), null);
  assert.deepEqual(resolveEstimate([7, 29, 34], 29, (n) => (n === 34 ? 300 : null)), null);
});

test("change since the first test", () => {
  assert.equal(Math.round(changeSince(240, 222) * 100), 8);
});
