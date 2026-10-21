import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateMax, barLoad, dbLoad, pieceLoads, resolveEstimate, changeSince, strengthMinutes } from "../../calc.js";

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

const strength = (n) => sessions.get(n).pieces.find((p) => p.type === "strength");

test("strength time: 1:00 per movement per set, rest only between sets", () => {
  assert.equal(strengthMinutes(strength(1)), 10);
  assert.equal(strengthMinutes(strength(4)), 14);
  assert.equal(strengthMinutes(strength(13)), 18);
  assert.equal(strengthMinutes(strength(34)), 14);
});

test("strength time skips add-ons done right after another movement", () => {
  assert.equal(strengthMinutes(strength(2)), 10);
});

test("strength time counts 2:00 for a movement over 15 reps and reads the rest", () => {
  const piece = { lines: ["Then 3 Sets:", "20 Air Squats", "10 Push-ups"], rotation: ["Rest at least 1:30 between sets."] };
  assert.equal(strengthMinutes(piece), 12);
});

test("strength time prefers clock_min from the plan", () => {
  assert.equal(strengthMinutes({ ...strength(1), clock_min: 12 }), 12);
});

test("every strength piece in the plan gets a time", () => {
  for (const [n] of sessions) assert.ok(strengthMinutes(strength(n)) > 0, `session ${n}`);
});

test("change since the first test", () => {
  assert.equal(Math.round(changeSince(240, 222) * 100), 8);
});
