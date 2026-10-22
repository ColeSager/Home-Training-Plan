import { estimateMax, pieceLoads, resolveEstimate, changeSince, strengthMinutes } from "./calc.js";
import { loadState, saveState, parseState, storageWorks } from "./store.js";

const PEOPLE = [
  ["him", "Ryan"],
  ["her", "Lauren"],
];
const PIECE_LABEL = { warmup: "Warm-Up", strength: "Strength", conditioning: "Conditioning" };
const LIFT_ORDER = ["bench", "squat", "deadlift"];
const LIFT_SHORT = { bench: "bench", squat: "squat", deadlift: "deadlift" };
const GAP_DAYS = 14;
const BOLD_PREFIX = /^(Station \d+:|Odd minutes:|Even minutes:)/;
const ITALIC_START = /^(Each minute:|Each station:|Each set:)/;

const ICON = {
  down: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  up: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  repeat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E2795C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
};

let plan = null;
let sessions = [];
let byN = new Map();
let groupOfN = new Map();
let testsByLift = new Map();
let demos = new Map();
let state = loadState();
const canStore = storageWorks();
let persistAsked = false;

const ui = { tab: "plan", group: 0, openSession: null, openPiece: null, scrollTo: null, focusKey: null };

const view = document.getElementById("view");
const sheet = document.getElementById("sheet");
const toastEl = document.getElementById("toast");
const restoreInput = document.getElementById("restore-input");

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const logKey = (n, type) => `${n}-${type}`;
const getLog = (n, type) => state.logs[logKey(n, type)];
const pieceDone = (n, type) => !!getLog(n, type)?.done;
const sessionDone = (n) => pieceDone(n, "strength") && pieceDone(n, "conditioning");
const pieceOf = (s, type) => s.pieces.find((p) => p.type === type);
const upNext = () => sessions.find((s) => !sessionDone(s.n)) ?? null;
const nowIso = () => new Date().toISOString();

function fmtClock(p) {
  if (p.type === "warmup") return p.clock ?? "";
  const min = p.type === "strength" ? strengthMinutes(p) : p.clock_min;
  if (min == null) return "";
  const secs = Math.round(min * 60);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function hasValues(log) {
  return !!(log && (log.him || log.her || log.together || log.notes));
}

function indexPlan(p) {
  plan = p;
  sessions = p.groups.flatMap((g) => g.sessions);
  byN = new Map(sessions.map((s) => [s.n, s]));
  groupOfN = new Map();
  p.groups.forEach((g, i) => g.sessions.forEach((s) => groupOfN.set(s.n, i)));
  testsByLift = new Map();
  for (const s of sessions) {
    const app = pieceOf(s, "strength")?.app;
    if (!app?.test) continue;
    if (!testsByLift.has(app.lift_key)) testsByLift.set(app.lift_key, []);
    testsByLift.get(app.lift_key).push(s.n);
  }
  for (const ns of testsByLift.values()) ns.sort((a, b) => a - b);
}

function testEstimate(lift, n, who) {
  const o = state.overrides[`${lift}-${n}`]?.[who];
  if (typeof o === "number" && o > 0) return { n, value: o, override: true };
  const v = getLog(n, "strength")?.[who];
  if (v?.weight > 0 && v?.reps > 0) return { n, value: estimateMax(v.weight, v.reps), weight: v.weight, reps: v.reps };
  return null;
}

function latestEstimate(lift, who) {
  const ns = testsByLift.get(lift) ?? [];
  for (let i = ns.length - 1; i >= 0; i--) {
    const e = testEstimate(lift, ns[i], who);
    if (e) return e;
  }
  return null;
}

function priced(app, who) {
  if (!app?.pct_lines?.length || app.estimate_from == null) return null;
  const r = resolveEstimate(testsByLift.get(app.lift_key) ?? [], app.estimate_from, (n) =>
    testEstimate(app.lift_key, n, who)?.value ?? null,
  );
  return r && { from: r.n, loads: pieceLoads(app, r.value, plan.equipment) };
}

function testSetLoad(p, who) {
  const app = p.app;
  if (!app?.test || !app.pct_lines.length) return null;
  let i = app.pct_lines.findIndex((x) => (p.lines[x.line] ?? "").startsWith(`${app.test.set_label}:`));
  if (i < 0) i = app.pct_lines.findIndex((x) => x.max_reps);
  const pr = i < 0 ? null : priced(app, who);
  return pr ? pr.loads[i] : null;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function gap(now = Date.now()) {
  let last = null;
  for (const [key, log] of Object.entries(state.logs)) {
    const t = Date.parse(log?.savedAt);
    if (!Number.isFinite(t)) continue;
    const n = parseInt(key, 10);
    if (!last || t > last.t || (t === last.t && n > last.n)) last = { t, n };
  }
  if (!last) return null;
  const days = Math.round((startOfDay(now) - startOfDay(last.t)) / 86400000);
  return days >= GAP_DAYS ? { days, n: last.n } : null;
}

function fmtSet(v) {
  if (!v) return "";
  const w = v.weight != null ? `${v.weight} lb` : "";
  const r = v.reps != null ? `x ${v.reps}` : "";
  return [w, r].filter(Boolean).join(" ");
}

function summary(n, p) {
  const log = getLog(n, p.type);
  if (!log) return "";
  if (p.type === "strength") {
    return PEOPLE.filter(([k]) => log[k])
      .map(([k, L]) => `${L} ${fmtSet(log[k])}`)
      .join(" · ");
  }
  if (p.type === "conditioning") {
    if (log.together?.score) return `Together ${log.together.score}`;
    return PEOPLE.filter(([k]) => log[k]?.score)
      .map(([k, L]) => `${L} ${log[k].score}`)
      .join(" · ");
  }
  return "";
}

function doneChips(s) {
  const chips = [];
  const str = getLog(s.n, "strength");
  for (const [k, L] of PEOPLE) if (str?.[k]) chips.push(`${L} · ${fmtSet(str[k])}`);
  const c = pieceOf(s, "conditioning");
  const cl = getLog(s.n, "conditioning");
  if (cl?.together?.score) chips.push(`Together · ${cl.together.score}`);
  else {
    const vals = PEOPLE.filter(([k]) => cl?.[k]?.score);
    if (vals.length === 2) chips.push(`${c.score_label}: ${cl.him.score} / ${cl.her.score}`);
    else if (vals.length === 1) chips.push(`${c.score_label}: ${vals[0][1]} ${cl[vals[0][0]].score}`);
  }
  return chips;
}

function metaLine(s) {
  return s.pieces.map((p) => [PIECE_LABEL[p.type], fmtClock(p)].filter(Boolean).join(" ")).join(" · ");
}

function lineHtml(line, i, chips) {
  if (line === "") return '<div class="gap" aria-hidden="true"></div>';
  const lead = line.endsWith(":");
  const cls = ["ln"];
  if (lead) cls.push("lead");
  if (ITALIC_START.test(line)) cls.push("it");
  const m = !lead && line.match(BOLD_PREFIX);
  const text = m ? `<span class="b">${esc(m[1])}</span>${esc(line.slice(m[1].length))}` : esc(line);
  if (chips == null) return `<div class="${cls.join(" ")}" data-line="${i}">${text}</div>`;
  cls.push("row");
  return `<div class="${cls.join(" ")}" data-line="${i}"><span class="set">${text}</span><span class="wt">${chips}</span></div>`;
}

function pctCaption(app, pr) {
  const prompt = `Log your Session ${app.estimate_from} test to fill these in`;
  const have = PEOPLE.filter(([k]) => pr[k]);
  if (!have.length) return `<p class="cap" data-testid="pct-prompt">${prompt}</p>`;
  const per = app.load_kind === "db" ? "Weights per dumbbell" : "Weights";
  const fallback = have.filter(([k]) => pr[k].from !== app.estimate_from).map(([k, L]) => `${L}: Session ${pr[k].from}`);
  const text = `${per}, from your Session ${app.estimate_from} test${fallback.length ? ` (${fallback.join(", ")})` : ""}`;
  const missing = PEOPLE.filter(([k]) => !pr[k])
    .map(([, L]) => `<p class="cap" data-testid="pct-prompt">${L}: ${prompt}</p>`)
    .join("");
  return `<p class="cap">${text}</p>${missing}`;
}

function pieceBody(s, p) {
  let html = "";
  const app = p.app;
  const pctAt = new Map((app?.pct_lines ?? []).map((x, i) => [x.line, i]));
  let pr = null;
  if (pctAt.size) {
    pr = { him: priced(app, "him"), her: priced(app, "her") };
    html += pctCaption(app, pr);
  }
  const chipsFor = (i) =>
    PEOPLE.filter(([k]) => pr[k])
      .map(([k, L]) => `<span class="chip" data-who="${k}">${L} ${pr[k].loads[i]}</span>`)
      .join("");
  html += `<div class="lines">${p.lines.map((line, i) => lineHtml(line, i, pctAt.has(i) ? chipsFor(pctAt.get(i)) : null)).join("")}</div>`;
  for (const r of p.rotation ?? []) html += `<p class="rot">• ${esc(r)}</p>`;
  if (p.notes) html += `<p class="note"><span class="note-label">Notes:</span> ${esc(p.notes)}</p>`;
  const done = pieceDone(s.n, p.type);
  const k = `${s.n}-${p.type}`;
  const chips = (p.movements ?? []).filter((m) => demos.get(m)?.url);
  if (chips.length) {
    html += `<div class="demos"><div class="eyebrow tone-muted">Demos</div><div class="demo-chips">${chips
      .map((m) => `<button class="demo-chip" data-action="demo" data-name="${esc(m)}" aria-label="Play demo: ${esc(m)}">${ICON.play}${esc(m)}</button>`)
      .join("")}</div></div>`;
  }
  html += `<div class="actions">
    <label class="btn outline done-toggle"><input type="checkbox" data-action="done" data-n="${s.n}" data-type="${p.type}" data-key="done-${k}"${done ? " checked" : ""}> Done</label>
    ${p.type === "warmup" ? "" : `<button class="btn primary" data-action="log" data-n="${s.n}" data-type="${p.type}" data-key="log-${k}">Log score</button>`}
  </div>`;
  return html;
}

function pieceHtml(s, p) {
  const open = ui.openSession === s.n && ui.openPiece === p.type;
  const done = pieceDone(s.n, p.type);
  const sum = summary(s.n, p);
  const clock = fmtClock(p);
  const k = `${s.n}-${p.type}`;
  const head = `<span class="piece-main">
      ${done ? `<span class="check" role="img" aria-label="Done">${ICON.check}</span>` : ""}
      <span class="piece-text">
        <span class="eyebrow tone-${p.type}">${PIECE_LABEL[p.type]}${clock ? ` · ${clock}` : ""}</span>
        ${sum ? `<span class="sum">${esc(sum)}</span>` : ""}
      </span>
    </span>${open ? ICON.up : ICON.down}`;
  const btn = `<button class="piece-toggle" data-action="piece" data-n="${s.n}" data-type="${p.type}" data-key="piece-${k}" aria-expanded="${open}"${open ? ` aria-controls="body-${k}"` : ""}>${head}</button>`;
  return `<div class="piece${open ? " is-open" : ""}${done ? " is-done" : ""}" id="piece-${k}" data-piece="${p.type}">${btn}${
    open ? `<div class="piece-body" id="body-${k}">${pieceBody(s, p)}</div>` : ""
  }</div>`;
}

function sessionCard(s, next) {
  const done = sessionDone(s.n);
  const isNext = next?.n === s.n;
  const open = ui.openSession === s.n;
  const count = s.pieces.filter((p) => pieceDone(s.n, p.type)).length;
  const tone = done ? "strength" : isNext ? "next" : "muted";
  const suffix = done ? "Done" : count ? `${count} of ${s.pieces.length} done` : isNext ? "Up next" : "";
  const eyebrow = `<span class="eyebrow tone-${tone}">${[`Session ${s.n}`, suffix].filter(Boolean).join(" · ")}</span>`;
  const title = `<span class="card-title">${esc(pieceOf(s, "strength")?.title ?? s.lift)}</span>`;
  const cls = `card session${isNext ? " is-next" : ""}${done ? " is-done" : ""}`;
  if (!open) {
    const chips = done ? doneChips(s) : [];
    const extra = chips.length
      ? `<span class="chips">${chips.map((c) => `<span class="pchip">${esc(c)}</span>`).join("")}</span>`
      : `<span class="meta">${esc(metaLine(s))}</span>`;
    return `<button class="${cls}" id="session-${s.n}" data-session="${s.n}" data-action="session" data-n="${s.n}" data-key="session-${s.n}" aria-expanded="false">
      <span class="card-head">${eyebrow}${ICON.down}</span>${title}${extra}</button>`;
  }
  return `<div class="${cls} is-open" id="session-${s.n}" data-session="${s.n}">
    <button class="card-toggle" data-action="session" data-n="${s.n}" data-key="session-${s.n}" aria-expanded="true">
      <span class="card-toggle-text">${eyebrow}${title}</span>${ICON.up}
    </button>
    ${s.pieces.map((p) => pieceHtml(s, p)).join("")}
  </div>`;
}

function statusText(g) {
  const doneNs = g.sessions.filter((s) => sessionDone(s.n)).map((s) => s.n);
  const left = g.sessions.length - doneNs.length;
  let text;
  if (!doneNs.length) text = `${left} to go`;
  else if (!left) text = `All ${g.sessions.length} done`;
  else text = `${doneNs.length === 1 ? "Session" : "Sessions"} ${doneNs.join(" and ")} done · ${left} to go`;
  return [g.tag, text].filter(Boolean).join(" · ");
}

function renderPlan() {
  const g = plan.groups[ui.group];
  const next = upNext();
  const pills = plan.groups
    .map((grp, i) => {
      const range = grp.label.replace(/^Sessions\s+/, "");
      const allDone = grp.sessions.every((s) => sessionDone(s.n));
      const sel = i === ui.group;
      const label = `${grp.label.replace("-", " to ")}${allDone ? ", done" : ""}`;
      return `<button class="pill${sel ? " is-selected" : ""}${allDone ? " is-done" : ""}" data-action="group" data-i="${i}" data-key="group-${i}" aria-pressed="${sel}" aria-label="${esc(label)}">${esc(range)}</button>`;
    })
    .join("");
  let lead = 0;
  while (lead < g.sessions.length && sessionDone(g.sessions[lead].n)) lead++;
  const fill = g.sessions.length > 1 ? (Math.min(lead, g.sessions.length - 1) / (g.sessions.length - 1)) * 100 : 0;
  const steps = g.sessions
    .map((s) => {
      const done = sessionDone(s.n);
      const cur = next?.n === s.n;
      const state = done ? "done" : cur ? "current" : "todo";
      return `<li><button class="step is-${state}" data-action="step" data-n="${s.n}" data-key="step-${s.n}" aria-label="Session ${s.n}${done ? ", done" : cur ? ", up next" : ""}">
        <span class="dot">${done ? ICON.check.replace('width="12" height="12"', 'width="14" height="14"') : ""}</span>
        <span class="step-label">Session ${s.n}</span></button></li>`;
    })
    .join("");
  const gp = gap();
  const banner = gp
    ? `<div class="gap-banner" role="status" data-testid="gap-banner">${ICON.repeat}<div><strong>It has been ${gp.days} days.</strong> Repeat Session ${gp.n} before moving on.</div></div>`
    : "";
  return `
    <section class="hero">
      <div class="eyebrow tone-next">${esc(g.phase.replace(/:\s*/, " · "))}</div>
      <h1 class="title">${esc(g.label)}</h1>
      <div class="status" data-testid="status">${esc(statusText(g))}</div>
    </section>
    <div class="pills" role="group" aria-label="Session groups">${pills}</div>
    ${banner}
    <div class="stepper-wrap"><div class="track" aria-hidden="true"><div class="fill" style="width:${fill}%"></div></div><ol class="stepper">${steps}</ol></div>
    <div class="cards">${g.sessions.map((s) => sessionCard(s, next)).join("")}</div>`;
}

function liftName(lift) {
  const n = testsByLift.get(lift)?.[0];
  return n != null ? byN.get(n).lift : lift;
}

function renderWeights() {
  const lifts = [...testsByLift.keys()].sort(
    (a, b) => (LIFT_ORDER.indexOf(a) + 1 || 99) - (LIFT_ORDER.indexOf(b) + 1 || 99),
  );
  const cards = lifts
    .map((lift) => {
      const tests = testsByLift.get(lift);
      const db = pieceOf(byN.get(tests[0]), "strength").app.load_kind === "db";
      const retest = sessions.find((s) => {
        const a = pieceOf(s, "strength")?.app;
        return a?.lift_key === lift && a.compare_to != null;
      });
      const whos = PEOPLE.map(([k, L]) => {
        const e = latestEstimate(lift, k);
        const target = e?.n ?? tests[0];
        let source = `Log your Session ${tests[0]} test`;
        if (e) source = e.override ? `Session ${e.n}: entered by hand` : `Session ${e.n}: ${e.weight} lb x ${e.reps}`;
        let change = "";
        if (e && retest && e.n === retest.n) {
          const cmp = pieceOf(retest, "strength").app.compare_to;
          const first = testEstimate(lift, cmp, k);
          if (first) {
            const pct = Math.round(changeSince(e.value, first.value) * 100);
            change = `<span class="cap change">${pct > 0 ? "+" : ""}${pct}% since Session ${cmp}</span>`;
          }
        }
        return `<button class="who" data-action="override" data-lift="${lift}" data-n="${target}" data-who="${k}" data-key="ov-${lift}-${k}" aria-label="${L}, ${esc(liftName(lift))}, ${e ? `${e.value} pounds` : "no estimate yet"}. Tap to correct.">
          <span class="cap">${L}</span><span class="num" data-testid="est-${lift}-${k}">${e ? e.value : "-"}</span><span class="cap">${esc(source)}</span>${change}</button>`;
      }).join("");
      return `<div class="card"><div class="eyebrow tone-muted">${esc(liftName(lift))}${db ? " · per dumbbell" : ""}</div><div class="who-row">${whos}</div></div>`;
    })
    .join("");
  const nexts = lifts
    .map((lift) => {
      const n = testsByLift.get(lift).find((t) => !pieceDone(t, "strength"));
      return n != null ? { n, lift } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
  const nextLine = nexts.length
    ? `<p class="s pad">Next update: ${nexts.map((x) => `Session ${x.n} for ${LIFT_SHORT[x.lift] ?? liftName(x.lift).toLowerCase()}`).join(", ")}.</p>`
    : "";
  return `
    <section class="hero">
      <h1 class="title sm">Working Weights</h1>
      <p class="sub">Estimated maxes from your logged test sets. Every percentage in the plan uses these. Tap a number to correct it.</p>
    </section>
    <div class="stack">${cards}${nextLine}</div>`;
}

function sessionsLogged() {
  const ns = new Set();
  for (const [key, log] of Object.entries(state.logs)) if (log?.done || hasValues(log)) ns.add(parseInt(key, 10));
  return ns.size;
}

function fmtDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderMore() {
  const count = sessionsLogged();
  return `
    <section class="hero"><h1 class="title sm">More</h1></section>
    <div class="stack">
      <div class="card">
        <div class="eyebrow tone-muted">Put it on your Home Screen</div>
        <p class="p"><strong>iPhone:</strong> open the link in Safari, tap Share, then Add to Home Screen.</p>
        <p class="p"><strong>Android:</strong> open the link in Chrome, tap the menu, then Install app.</p>
        <p class="s">Log from the Home Screen icon every time. The browser tab keeps a separate log.</p>
      </div>
      <div class="card">
        <div class="eyebrow tone-muted">Your log</div>
        <p class="p" data-testid="log-count">${count} ${count === 1 ? "session" : "sessions"} logged · last backup: ${esc(fmtDate(state.lastBackupAt))}</p>
        ${canStore ? "" : '<p class="s warn">This browser is not saving your log. Open the app from the Home Screen icon.</p>'}
        <button class="btn primary" data-action="backup" data-key="backup">Back up</button>
        <p class="s">Saves one file you can keep in iCloud Drive or Google Drive. Back up every few sessions.</p>
        <button class="btn outline" data-action="restore" data-key="restore">Restore from a backup</button>
      </div>
      <button class="card row-link" data-action="demos" data-key="demos"><span class="p strong">Movement demos</span>${ICON.right}</button>
      <button class="card row-link" data-action="howto" data-key="howto"><span class="p strong">How to read this plan</span>${ICON.right}</button>
    </div>`;
}

function render() {
  const activeKey = ui.focusKey ?? document.activeElement?.dataset?.key;
  ui.focusKey = null;
  if (!plan) return;
  view.innerHTML =
    ui.tab === "weights" ? renderWeights() : ui.tab === "demos" ? renderDemos() : ui.tab === "more" ? renderMore() : renderPlan();
  for (const b of document.querySelectorAll(".tab")) {
    if (b.dataset.tab === (ui.tab === "demos" ? "more" : ui.tab)) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (activeKey) view.querySelector(`[data-key="${activeKey}"]`)?.focus({ preventScroll: true });
  if (ui.scrollTo) {
    const el = document.getElementById(ui.scrollTo);
    ui.scrollTo = null;
    if (el) bringIntoView(el);
  }
}

function bringIntoView(el) {
  const top = el.getBoundingClientRect().top;
  if (top >= 8 && top <= window.innerHeight * 0.5) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollBy({ top: top - 12, behavior: smooth ? "smooth" : "auto" });
}

function selectedPillIntoView() {
  const pill = view.querySelector(".pill.is-selected");
  const row = pill?.parentElement;
  if (row) row.scrollLeft = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
}

function commit() {
  const ok = saveState(state);
  if (ok && !persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
  render();
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2800);
}

function openSession(n) {
  if (ui.openSession === n) {
    ui.openSession = null;
    ui.openPiece = null;
  } else {
    ui.group = groupOfN.get(n);
    ui.openSession = n;
    ui.openPiece = null;
    ui.scrollTo = `session-${n}`;
  }
  render();
}

function togglePiece(n, type) {
  ui.openSession = n;
  ui.openPiece = ui.openPiece === type ? null : type;
  if (ui.openPiece) ui.scrollTo = `piece-${n}-${type}`;
  render();
}

function advance(n, type) {
  const s = byN.get(n);
  const i = s.pieces.findIndex((p) => p.type === type);
  const next = s.pieces.slice(i + 1).find((p) => !pieceDone(n, p.type));
  ui.openSession = n;
  ui.openPiece = next?.type ?? null;
  ui.scrollTo = `piece-${n}-${next?.type ?? type}`;
  ui.focusKey = `piece-${n}-${next?.type ?? type}`;
}

function setDone(n, type, checked) {
  const key = logKey(n, type);
  const cur = state.logs[key];
  if (checked) {
    state.logs[key] = { him: null, her: null, notes: "", ...cur, done: true, savedAt: nowIso() };
    advance(n, type);
  } else if (cur) {
    if (hasValues(cur)) state.logs[key] = { ...cur, done: false };
    else delete state.logs[key];
  }
  commit();
}

function sheetShell(eyebrowTone, eyebrow, title, body, label) {
  return `<form class="sheet-body" method="dialog" aria-label="${esc(label)}">
    <div class="handle" aria-hidden="true"></div>
    <div class="sheet-head">
      <div class="sheet-titles"><div class="eyebrow tone-${eyebrowTone}">${esc(eyebrow)}</div><h2 class="sheet-title" tabindex="-1" autofocus>${esc(title)}</h2></div>
      <button type="button" class="close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
    </div>
    ${body}
  </form>`;
}

function showSheet(html, onSubmit) {
  sheet.innerHTML = html;
  sheet.onsubmit = (e) => {
    e.preventDefault();
    onSubmit(e.target);
  };
  if (!sheet.open) sheet.showModal();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

function field(name, label, value, mode, extraCls = "", placeholder = "") {
  return `<label class="fld${extraCls}"><span class="lab">${esc(label)}</span><input class="inp" name="${name}" inputmode="${mode}" autocomplete="off" value="${esc(value ?? "")}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}></label>`;
}

function openLog(n, type) {
  const s = byN.get(n);
  const p = pieceOf(s, type);
  const log = getLog(n, type);
  const shared = type === "conditioning" && p.score_shared;
  let body = "";
  let title = type === "strength" ? "Log your last set" : "Log your score";
  if (type === "strength") {
    if (p.app?.test) title = `Session ${n} test: ${p.app.test.set_label}`;
    body = PEOPLE.map(([k, L]) => {
      const saved = log?.[k];
      const weight = saved?.weight ?? (p.app?.test ? testSetLoad(p, k) : null);
      return `<div class="who-block" data-who="${k}"><div class="who-name">${L}</div><div class="fields">
        ${field(`${k}-weight`, `${s.lift} (lb)`, weight, "decimal")}
        ${field(`${k}-reps`, "Reps", saved?.reps, "numeric", " reps")}
      </div></div>`;
    }).join("");
  } else if (shared) {
    body = `<div class="who-block" data-who="together"><div class="who-name">Together</div>${field("together-score", p.score_label, log?.together?.score, "text")}</div>`;
  } else {
    body = PEOPLE.map(
      ([k, L]) =>
        `<div class="who-block" data-who="${k}"><div class="who-name">${L}</div>${field(`${k}-score`, p.score_label, log?.[k]?.score, "text")}</div>`,
    ).join("");
  }
  body += `${field("notes", "Notes", log?.notes, "text", "", "Optional")}
    <button type="submit" class="btn primary big">Save and mark done</button>
    ${shared ? '<p class="s center">You go, I go pieces log one shared score.</p>' : ""}`;
  const html = sheetShell(type, `Session ${n} · ${PIECE_LABEL[type]}`, title, body, `Log ${PIECE_LABEL[type].toLowerCase()}`);
  showSheet(html, (form) => saveLog(n, type, shared, form));
}

function num(v) {
  const x = parseFloat(String(v).trim().replace(",", "."));
  return Number.isFinite(x) && x >= 0 ? x : null;
}

function saveLog(n, type, shared, form) {
  const entry = { done: true, him: null, her: null, notes: form.notes.value.trim(), savedAt: nowIso() };
  if (type === "strength") {
    for (const [k] of PEOPLE) {
      const weight = num(form[`${k}-weight`].value);
      const reps = num(form[`${k}-reps`].value);
      if (weight != null || reps != null) entry[k] = { weight, reps: reps == null ? null : Math.round(reps) };
    }
  } else if (shared) {
    const score = form["together-score"].value.trim();
    if (score) entry.together = { score };
  } else {
    for (const [k] of PEOPLE) {
      const score = form[`${k}-score`].value.trim();
      if (score) entry[k] = { score };
    }
  }
  state.logs[logKey(n, type)] = entry;
  closeSheet();
  advance(n, type);
  commit();
}

function openOverride(lift, n, who) {
  const label = PEOPLE.find(([k]) => k === who)[1];
  const db = pieceOf(byN.get(n), "strength").app.load_kind === "db";
  const key = `${lift}-${n}`;
  const has = typeof state.overrides[key]?.[who] === "number";
  const e = testEstimate(lift, n, who);
  const body = `${field("value", `Estimated max (lb)${db ? ", per dumbbell" : ""}`, e?.value, "numeric")}
    <p class="s">Sets the Session ${n} estimate and every weight priced from it. Leave blank to use the logged test.</p>
    <button type="submit" class="btn primary big">Save</button>
    ${has ? '<button type="button" class="btn outline big" data-action="clear-override">Use the logged test</button>' : ""}`;
  showSheet(sheetShell("muted", liftName(lift), `${label}: estimated max`, body, "Correct estimated max"), (form) => {
    const v = num(form.value.value);
    setOverride(key, who, v ? Math.round(v) : null);
  });
  sheet.dataset.override = JSON.stringify({ key, who });
}

function setOverride(key, who, value) {
  const cur = { ...state.overrides[key] };
  if (value) cur[who] = value;
  else delete cur[who];
  if (Object.keys(cur).length) state.overrides[key] = cur;
  else delete state.overrides[key];
  closeSheet();
  commit();
}

function renderDemos() {
  const rows = [...demos.values()]
    .filter((m) => m.url)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (m) =>
        `<button class="demo-row" data-action="demo" data-name="${esc(m.name)}" data-key="demo-${esc(m.name)}"><span>${esc(m.name)}</span><span class="demo-play">${ICON.play}</span></button>`,
    )
    .join("");
  return `
    <section class="hero">
      <button class="back" data-action="more-back" data-key="more-back">${ICON.back}More</button>
      <h1 class="title sm">Movement demos</h1>
    </section>
    <div class="stack">
      <input id="demo-search" class="inp" type="search" placeholder="Search movements" aria-label="Search movements" autocomplete="off">
      <div class="demo-list">${rows}</div>
    </div>`;
}

function openDemo(name) {
  const m = demos.get(name);
  if (!m?.url) return;
  const player = navigator.onLine
    ? `<div class="video"><iframe src="${esc(m.embed)}" title="${esc(m.name)} demo" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
    : '<p class="video-offline">Videos need an internet connection.</p>';
  const body = `${player}
    <a class="btn outline big" href="${esc(m.url)}" target="_blank" rel="noopener">Open in Vimeo</a>`;
  showSheet(sheetShell("muted", "Demo", m.name, body, `${m.name} demo`), () => closeSheet());
}

function openHowTo() {
  const body = `<ol class="howto">${plan.how_to_read.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`;
  showSheet(sheetShell("muted", "More", "How to read this plan", body, "How to read this plan"), () => closeSheet());
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function backup() {
  const now = new Date();
  const name = `home-training-log-${ymd(now)}.json`;
  const data = JSON.stringify({ ...state, lastBackupAt: now.toISOString() }, null, 2);
  const file = new File([data], name, { type: "application/json" });
  const done = () => {
    state.lastBackupAt = now.toISOString();
    commit();
    toast("Backup saved");
  };
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      done();
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  done();
}

async function restoreFrom(file) {
  const data = parseState(await file.text());
  if (!data) {
    toast("That file is not a Home Training Plan backup.");
    return;
  }
  const incoming = new Set(Object.keys(data.logs).map((k) => parseInt(k, 10))).size;
  const msg = `Replace the log on this phone (${sessionsLogged()} sessions) with this backup (${incoming} sessions)?`;
  if (!window.confirm(msg)) return;
  state = data;
  commit();
  toast("Backup restored");
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, n, type } = el.dataset;
  switch (action) {
    case "tab":
      ui.tab = el.dataset.tab;
      render();
      window.scrollTo(0, 0);
      if (ui.tab === "plan") selectedPillIntoView();
      break;
    case "group":
      ui.group = Number(el.dataset.i);
      ui.openSession = null;
      ui.openPiece = null;
      render();
      break;
    case "session":
      openSession(Number(n));
      break;
    case "step":
      if (ui.openSession === Number(n)) bringIntoView(document.getElementById(`session-${n}`));
      else openSession(Number(n));
      break;
    case "piece":
      togglePiece(Number(n), type);
      break;
    case "log":
      openLog(Number(n), type);
      break;
    case "override":
      openOverride(el.dataset.lift, Number(n), el.dataset.who);
      break;
    case "clear-override": {
      const { key, who } = JSON.parse(sheet.dataset.override);
      setOverride(key, who, null);
      break;
    }
    case "close-sheet":
      closeSheet();
      break;
    case "demo":
      openDemo(el.dataset.name);
      break;
    case "demos":
    case "more-back":
      ui.tab = action === "demos" ? "demos" : "more";
      render();
      window.scrollTo(0, 0);
      break;
    case "howto":
      openHowTo();
      break;
    case "backup":
      backup();
      break;
    case "restore":
      restoreInput.value = "";
      restoreInput.click();
      break;
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches('input[data-action="done"]')) setDone(Number(t.dataset.n), t.dataset.type, t.checked);
});

restoreInput.addEventListener("change", () => {
  const f = restoreInput.files?.[0];
  if (f) restoreFrom(f);
});

sheet.addEventListener("click", (e) => {
  if (e.target === sheet) closeSheet();
});

sheet.addEventListener("close", () => {
  for (const f of sheet.querySelectorAll("iframe")) f.remove();
});

view.addEventListener("input", (e) => {
  if (e.target.id !== "demo-search") return;
  const q = e.target.value.trim().toLowerCase();
  for (const row of view.querySelectorAll(".demo-row")) row.hidden = !row.dataset.name.toLowerCase().includes(q);
});

async function start() {
  const demosLoad = fetch("data/demos.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { movements: [] }))
    .catch(() => ({ movements: [] }));
  try {
    const res = await fetch("data/plan.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    indexPlan(await res.json());
    demos = new Map((await demosLoad).movements.map((m) => [m.name, m]));
  } catch {
    view.innerHTML = '<p class="load-error">Could not load the plan. Check your connection and open the app again.</p>';
    return;
  }
  const next = upNext();
  ui.group = next ? groupOfN.get(next.n) : plan.groups.length - 1;
  render();
  selectedPillIntoView();
  document.documentElement.dataset.ready = "1";
}

start();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
