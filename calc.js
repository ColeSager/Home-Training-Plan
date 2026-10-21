export function estimateMax(weight, reps) {
  return Math.floor((weight * (30 + reps)) / 30 + 0.5);
}

// Loads are compared in thousandths of a pound so float noise in est x pct never moves a rounding boundary.
const milli = (pct) => Math.round(pct * 1000);

export function barLoad(est, pct, maxReps, loads) {
  const target = est * milli(pct);
  if (maxReps) {
    const whole = Math.floor((target + 500) / 1000);
    let best = loads[0];
    for (const l of loads) if (Math.abs(l - whole) < Math.abs(best - whole)) best = l;
    return best;
  }
  let best = loads[0];
  for (const l of loads) if (l * 1000 <= target) best = l;
  return best;
}

export function dbLoad(est, pct, maxReps, step) {
  const target = est * milli(pct);
  const unit = step * 1000;
  const n = maxReps ? Math.floor((target + unit / 2) / unit) : Math.floor(target / unit);
  return Math.max(step, n * step);
}

export function pieceLoads(app, est, equipment) {
  return app.pct_lines.map((p) =>
    app.load_kind === "db"
      ? dbLoad(est, p.pct, p.max_reps, equipment.db_step_lb)
      : barLoad(est, p.pct, p.max_reps, equipment.bar_loads_lb),
  );
}

export function resolveEstimate(testNs, estimateFrom, estimateAt) {
  const own = estimateAt(estimateFrom);
  if (own != null) return { n: estimateFrom, value: own };
  const earlier = testNs.filter((n) => n < estimateFrom).sort((a, b) => b - a);
  for (const n of earlier) {
    const v = estimateAt(n);
    if (v != null) return { n, value: v };
  }
  return null;
}

const SETS = /^Then (\d+) Sets:$/;
const REST = /Rest at least (\d+):(\d{2}) between sets/;

export function strengthMinutes(piece) {
  if (piece.clock_min != null) return piece.clock_min;
  const start = piece.lines.findIndex((l) => SETS.test(l));
  if (start < 0) return null;
  const sets = Number(piece.lines[start].match(SETS)[1]);
  let perSet = 0;
  let mainLift = false;
  for (const line of piece.lines.slice(start + 1)) {
    if (/^Sets? \d/.test(line)) {
      if (!mainLift) perSet += 1;
      mainLift = true;
      continue;
    }
    if (/right after/.test(line)) continue;
    const reps = line.match(/^(\d+)(?:-(\d+))?\s/);
    if (!reps) continue;
    perSet += Math.max(1, Math.ceil(Number(reps[2] ?? reps[1]) / 15));
  }
  if (!perSet) return null;
  const rest = (piece.rotation ?? []).join(" ").match(REST);
  const restMin = rest ? Number(rest[1]) + Number(rest[2]) / 60 : 2;
  return sets * perSet + (sets - 1) * restMin;
}

export function changeSince(retest, first) {
  return retest / first - 1;
}
