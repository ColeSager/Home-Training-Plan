import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(new URL("../../data/plan.json", import.meta.url), "utf8"));
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/calc_fixtures.json", import.meta.url), "utf8"));
const sessions = plan.groups.flatMap((g) => g.sessions);
const groupOf = (n) => plan.groups.find((g) => g.sessions.some((s) => s.n === n));

async function open(page) {
  await page.goto("./");
  await expect(page.locator("html[data-ready]")).toBeAttached();
}

async function showGroup(page, n) {
  const range = groupOf(n).label.replace(/^Sessions\s+/, "");
  await page.locator(".pill").filter({ hasText: new RegExp(`^${range}$`) }).click();
}

async function openSession(page, n) {
  await showGroup(page, n);
  const card = page.locator(`#session-${n}`);
  if ((await card.getAttribute("aria-expanded")) === "false") await card.click();
  await expect(page.locator(`#session-${n}.is-open`)).toBeVisible();
}

async function openPiece(page, n, type) {
  const piece = page.locator(`#piece-${n}-${type}`);
  if (!(await piece.evaluate((el) => el.classList.contains("is-open")))) await piece.locator(".piece-toggle").click();
  await expect(piece).toHaveClass(/is-open/);
}

async function logStrength(page, n, him, her) {
  await openPiece(page, n, "strength");
  await page.locator(`#piece-${n}-strength [data-action="log"]`).click();
  const sheet = page.locator("#sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator('input[name="him-weight"]').fill(String(him[0]));
  await sheet.locator('input[name="him-reps"]').fill(String(him[1]));
  await sheet.locator('input[name="her-weight"]').fill(String(her[0]));
  await sheet.locator('input[name="her-reps"]').fill(String(her[1]));
  await sheet.getByRole("button", { name: "Save and mark done" }).click();
  await expect(sheet).toBeHidden();
}

async function logConditioning(page, n, him, her) {
  await openPiece(page, n, "conditioning");
  await page.locator(`#piece-${n}-conditioning [data-action="log"]`).click();
  const sheet = page.locator("#sheet");
  await sheet.locator('input[name="him-score"]').fill(him);
  await sheet.locator('input[name="her-score"]').fill(her);
  await sheet.getByRole("button", { name: "Save and mark done" }).click();
  await expect(sheet).toBeHidden();
}

test("a session opens folded, then only one piece is open at a time", async ({ page }) => {
  await open(page);
  await openSession(page, 2);
  await expect(page.locator("#session-2 .piece")).toHaveCount(3);
  await expect(page.locator(".piece.is-open")).toHaveCount(0);
  for (const type of ["strength", "conditioning", "warmup"]) {
    await page.locator(`#piece-2-${type} .piece-toggle`).click();
    await expect(page.locator(".piece.is-open")).toHaveCount(1);
    await expect(page.locator(`#piece-2-${type}`)).toHaveClass(/is-open/);
  }
  await page.locator("#session-3").click();
  await expect(page.locator(".session.is-open")).toHaveCount(1);
});

test("logging strength marks it done, folds it, opens conditioning, and persists", async ({ page }) => {
  await open(page);
  await openSession(page, 2);
  await logStrength(page, 2, [115, 10], [75, 10]);
  const strength = page.locator("#piece-2-strength");
  await expect(strength).not.toHaveClass(/is-open/);
  await expect(strength.locator(".check")).toBeVisible();
  await expect(strength.locator(".sum")).toHaveText("Him 115 lb x 10 · Her 75 lb x 10");
  await expect(page.locator("#piece-2-conditioning")).toHaveClass(/is-open/);
  await expect(page.locator(".piece.is-open")).toHaveCount(1);

  await page.reload();
  await expect(page.locator("html[data-ready]")).toBeAttached();
  await openSession(page, 2);
  await expect(page.locator("#piece-2-strength .check")).toBeVisible();
  await expect(page.locator("#piece-2-strength .sum")).toHaveText("Him 115 lb x 10 · Her 75 lb x 10");
});

test("finishing strength and conditioning completes the session and the stepper", async ({ page }) => {
  await open(page);
  await openSession(page, 1);
  await logStrength(page, 1, [45, 10], [25, 10]);
  await logConditioning(page, 1, "9", "8");
  await expect(page.locator("#session-1 .card-toggle .eyebrow")).toHaveText("Session 1 · Done");
  await expect(page.getByRole("button", { name: "Session 1, done" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 2, up next" })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("Session 1 done · 2 to go");

  await page.locator("#session-1 .card-toggle").click();
  await expect(page.locator("#session-1 .pchip")).toHaveText(["Him · 45 lb x 10", "Her · 25 lb x 10", "Rounds + reps, all 4 sets: 9 / 8"]);
});

test("Session 8 and 9 tests price Sessions 13 to 21 like the fixtures", async ({ page }) => {
  const bench = { him: [45, 7], her: [25, 8] };
  const squat = { him: [185, 6], her: [95, 8] };
  const fx = (kind, [w, r]) => fixtures.find((f) => f.kind === kind && f.test_weight === w && f.test_reps === r);
  await open(page);
  await openSession(page, 8);
  await logStrength(page, 8, bench.him, bench.her);
  await openSession(page, 9);
  await logStrength(page, 9, squat.him, squat.her);

  let checked = 0;
  for (const s of sessions.filter((x) => x.n >= 13 && x.n <= 21)) {
    const app = s.pieces.find((p) => p.type === "strength").app;
    if (!app.pct_lines.length) continue;
    const src = app.lift_key === "bench" ? bench : squat;
    await openSession(page, s.n);
    await openPiece(page, s.n, "strength");
    for (const who of ["him", "her"]) {
      const expected = fx(app.load_kind, src[who]).sessions[String(s.n)];
      const label = who === "him" ? "Him" : "Her";
      await expect(page.locator(`#piece-${s.n}-strength .chip[data-who="${who}"]`)).toHaveText(
        expected.map((v) => `${label} ${v}`),
      );
      checked++;
    }
  }
  expect(checked).toBe(12);
});

test("percent rows prompt for the test when there is no estimate", async ({ page }) => {
  await open(page);
  await openSession(page, 13);
  await openPiece(page, 13, "strength");
  await expect(page.getByTestId("pct-prompt")).toHaveText("Log your Session 8 test to fill these in");
  await expect(page.locator("#piece-13-strength .chip")).toHaveCount(0);
});

test("a test-set log prefills the computed load and labels the set", async ({ page }) => {
  await open(page);
  await openSession(page, 9);
  await logStrength(page, 9, [185, 6], [95, 8]);
  await openSession(page, 19);
  await openPiece(page, 19, "strength");
  await page.locator('#piece-19-strength [data-action="log"]').click();
  const sheet = page.locator("#sheet");
  await expect(sheet.locator(".sheet-title")).toHaveText("Session 19 test: Set 3");
  await expect(sheet.locator('input[name="him-weight"]')).toHaveValue("175");
  await expect(sheet.locator('input[name="her-weight"]')).toHaveValue("95");
});

test("back up, clear, and restore brings the log back", async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "canShare", { value: () => false, configurable: true });
  });
  await open(page);
  await openSession(page, 1);
  await logStrength(page, 1, [45, 10], [25, 10]);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByTestId("log-count")).toContainText("1 session logged · last backup: never");

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^home-training-log-\d{4}-\d{2}-\d{2}\.json$/);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(page.getByTestId("log-count")).not.toContainText("never");

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("html[data-ready]")).toBeAttached();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByTestId("log-count")).toContainText("0 sessions logged");

  page.once("dialog", (d) => d.accept());
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from a backup" }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId("log-count")).toContainText("1 session logged");

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await openSession(page, 1);
  await expect(page.locator("#piece-1-strength .sum")).toHaveText("Him 45 lb x 10 · Her 25 lb x 10");
});

test("restore rejects a file that is not a backup", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from a backup" }).click();
  await (await chooser).setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator("#toast")).toHaveText("That file is not a Home Training Plan backup.");
});

test("a 15-day gap names the last logged session", async ({ page }) => {
  await page.addInitScript(() => {
    const day = 86400000;
    const at = (d) => new Date(Date.now() - d * day).toISOString();
    const log = (d) => ({ done: true, him: null, her: null, notes: "", savedAt: at(d) });
    if (!localStorage.getItem("htp.v1")) {
      localStorage.setItem(
        "htp.v1",
        JSON.stringify({
          schema: 1,
          logs: { "3-strength": log(20), "3-conditioning": log(20), "4-strength": log(15) },
          overrides: {},
          lastBackupAt: null,
        }),
      );
    }
  });
  await open(page);
  await expect(page.getByTestId("gap-banner")).toHaveText("It has been 15 days. Repeat Session 4 before moving on.");

  await openSession(page, 4);
  await openPiece(page, 4, "warmup");
  await page.locator('#piece-4-warmup input[data-action="done"]').click();
  await expect(page.getByTestId("gap-banner")).toHaveCount(0);
});

test("a you go, I go piece logs one Together score", async ({ page }) => {
  await open(page);
  await openSession(page, 5);
  await openPiece(page, 5, "conditioning");
  await page.locator('#piece-5-conditioning [data-action="log"]').click();
  const sheet = page.locator("#sheet");
  await expect(sheet.locator(".who-block")).toHaveCount(1);
  await expect(sheet.locator(".who-name")).toHaveText("Together");
  await expect(sheet.getByLabel("Rounds + reps, together")).toBeVisible();
  await sheet.getByLabel("Rounds + reps, together").fill("11 rounds + 40");
  await sheet.getByRole("button", { name: "Save and mark done" }).click();
  await expect(page.locator("#piece-5-conditioning .sum")).toHaveText("Together 11 rounds + 40");
});

test("Done on warm-up advances to strength; unchecking keeps logged values", async ({ page }) => {
  await open(page);
  await openSession(page, 1);
  await openPiece(page, 1, "warmup");
  await page.locator('#piece-1-warmup input[data-action="done"]').click();
  await expect(page.locator("#piece-1-strength")).toHaveClass(/is-open/);
  await logStrength(page, 1, [50, 8], [30, 8]);
  await openPiece(page, 1, "strength");
  await page.locator('#piece-1-strength input[data-action="done"]').click();
  await expect(page.locator("#piece-1-strength .check")).toHaveCount(0);
  await expect(page.locator("#piece-1-strength .sum")).toHaveText("Him 50 lb x 8 · Her 30 lb x 8");
});

test("Weights tab shows estimates, sources, and takes an override", async ({ page }) => {
  await open(page);
  await openSession(page, 8);
  await logStrength(page, 8, [45, 7], [25, 8]);
  await page.getByRole("button", { name: "Weights", exact: true }).click();
  await expect(page.getByTestId("est-bench-him")).toHaveText("56");
  await expect(page.getByTestId("est-bench-her")).toHaveText("32");
  await expect(page.locator("#view")).toContainText("Session 8: 45 lb x 7");
  await expect(page.locator("#view")).toContainText("Next update: Session 7 for deadlift, Session 9 for squat, Session 20 for bench.");

  await page.locator('[data-action="override"][data-lift="bench"][data-who="him"]').click();
  await page.locator('#sheet input[name="value"]').fill("60");
  await page.locator("#sheet").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("est-bench-him")).toHaveText("60");
  await expect(page.locator("#view")).toContainText("Session 8: entered by hand");

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await openSession(page, 13);
  await openPiece(page, 13, "strength");
  await expect(page.locator('#piece-13-strength .chip[data-who="him"]')).toHaveText(["Him 35", "Him 40", "Him 45", "Him 40"]);
});

test("retest shows change since the first test", async ({ page }) => {
  await page.addInitScript(() => {
    const s = (him, her) => ({ done: true, him, her, notes: "", savedAt: new Date().toISOString() });
    localStorage.setItem(
      "htp.v1",
      JSON.stringify({
        schema: 1,
        logs: {
          "9-strength": s({ weight: 185, reps: 6 }, { weight: 95, reps: 8 }),
          "36-strength": s({ weight: 205, reps: 6 }, null),
        },
        overrides: {},
        lastBackupAt: null,
      }),
    );
  });
  await open(page);
  await page.getByRole("button", { name: "Weights", exact: true }).click();
  await expect(page.getByTestId("est-squat-him")).toHaveText("246");
  await expect(page.locator('[data-lift="squat"][data-who="him"]')).toContainText("+11% since Session 9");
  await expect(page.getByTestId("est-squat-her")).toHaveText("120");
});

test("the app renders when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await open(page);
  await expect(page.locator("h1")).toHaveText("Sessions 1-3");
  await openSession(page, 1);
  await logStrength(page, 1, [45, 10], [25, 10]);
  await expect(page.locator("#piece-1-strength .check")).toBeVisible();
});

test("every session renders every line", async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  for (const s of sessions) {
    await openSession(page, s.n);
    for (const p of s.pieces) {
      await openPiece(page, s.n, p.type);
      const body = page.locator(`#body-${s.n}-${p.type}`);
      const rendered = await body.locator("[data-line]").evaluateAll((els) =>
        els.map((el) => ({ i: Number(el.dataset.line), text: (el.querySelector(".set") ?? el).textContent })),
      );
      const expected = p.lines.map((text, i) => ({ i, text })).filter((x) => x.text !== "");
      expect(rendered, `session ${s.n} ${p.type}`).toEqual(expected);
      await expect(body.locator(".gap")).toHaveCount(p.lines.filter((l) => l === "").length);
      if (p.rotation) await expect(body.locator(".rot")).toHaveText(p.rotation.map((r) => `• ${r}`));
      if (p.notes) await expect(body.locator(".note")).toHaveText(`Notes: ${p.notes}`);
    }
  }
});

test("line styling follows the plan rules", async ({ page }) => {
  await open(page);
  await openSession(page, 2);
  await openPiece(page, 2, "strength");
  await expect(page.locator('#body-2-strength [data-line="0"]')).toHaveClass(/lead/);
  await openPiece(page, 2, "conditioning");
  await expect(page.locator('#body-2-conditioning [data-line="1"] .b')).toHaveText("Station 1:");
  await expect(page.locator("#piece-2-conditioning .piece-toggle .eyebrow")).toHaveText("Conditioning · 16:00");
  await expect(page.locator("#piece-2-strength .piece-toggle .eyebrow")).toHaveText("Strength · 10:00");
  await openPiece(page, 2, "warmup");
  await expect(page.locator("#piece-2-warmup .piece-toggle .eyebrow")).toHaveText("Warm-Up · 8:30");
  await expect(page.locator('#piece-2-warmup [data-action="log"]')).toHaveCount(0);
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });

  test("opens and logs offline after the first visit", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Playwright WebKit does not run service workers");
    await open(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("html[data-ready]")).toBeAttached();
    await expect(page.locator("h1")).toHaveText("Sessions 1-3");
    expect(await page.evaluate(() => document.fonts.check('16px "Suisse Intl"'))).toBe(true);
    await openSession(page, 1);
    await logStrength(page, 1, [45, 10], [25, 10]);
    await expect(page.locator("#piece-1-strength .check")).toBeVisible();
  });
});

test.describe("movement demos", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/vimeo\.com/, (route) => route.abort());
  });

  const chips = (page, n, type) => page.locator(`#piece-${n}-${type} .demo-chip`);

  test("Session 1 Strength shows its demo chips in order", async ({ page }) => {
    await open(page);
    await openSession(page, 1);
    await openPiece(page, 1, "strength");
    await expect(chips(page, 1, "strength")).toHaveText(["Dumbbell Bench Press", "TRX Rows"]);
    await expect(page.getByRole("button", { name: "Play demo: TRX Rows" })).toBeVisible();
  });

  test("Session 1 Warm-Up shows only movements that have a video", async ({ page }) => {
    await open(page);
    await openSession(page, 1);
    await openPiece(page, 1, "warmup");
    await expect(chips(page, 1, "warmup")).toHaveText(["Band Pull-Aparts", "Band Pass-Throughs"]);
  });

  test("a chip opens the video sheet and closing removes the player", async ({ page }) => {
    await open(page);
    await openSession(page, 1);
    await openPiece(page, 1, "strength");
    await page.getByRole("button", { name: "Play demo: Dumbbell Bench Press" }).click();
    const sheet = page.locator("#sheet");
    await expect(sheet.locator(".sheet-title")).toHaveText("Dumbbell Bench Press");
    await expect(sheet.locator(".eyebrow")).toHaveText("Demo");
    await expect(sheet.locator("iframe")).toHaveAttribute("src", "https://player.vimeo.com/video/1122079118?h=1b23b6081b");
    await expect(sheet.getByRole("link", { name: "Open in Vimeo" })).toHaveAttribute("href", "https://vimeo.com/1122079118/1b23b6081b");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#sheet iframe")).toHaveCount(0);
  });

  test("a borrowed video names its source", async ({ page }) => {
    await open(page);
    await openSession(page, 1);
    await openPiece(page, 1, "strength");
    await page.getByRole("button", { name: "Play demo: TRX Rows" }).click();
    await expect(page.locator("#sheet")).toContainText("Video: Ring Rows");
  });

  test("More lists every movement with a video and searches by name", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "Movement demos" }).click();
    await expect(page.locator("h1")).toHaveText("Movement demos");
    await expect(page.locator(".demo-row")).toHaveCount(53);
    await page.getByRole("searchbox", { name: "Search movements" }).fill("squat");
    await expect(page.locator(".demo-row:visible")).toHaveText([
      "Air Squats",
      "Back Squat",
      "Dumbbell Front Squats",
      "Front Squat",
      "Kettlebell Goblet Squats",
      "Spanish Squats",
      "Squat Jumps",
    ]);
    await page.locator(".demo-row:visible", { hasText: "Back Squat" }).click();
    await expect(page.locator("#sheet .sheet-title")).toHaveText("Back Squat");
    await page.locator("#sheet").getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "More", exact: true }).first().click();
    await expect(page.locator("h1")).toHaveText("More");
  });

  test("offline, a chip shows the offline message and keeps the Vimeo link", async ({ page, context }) => {
    await open(page);
    await context.setOffline(true);
    await openSession(page, 1);
    await openPiece(page, 1, "strength");
    await page.getByRole("button", { name: "Play demo: Dumbbell Bench Press" }).click();
    const sheet = page.locator("#sheet");
    await expect(sheet).toContainText("Videos need an internet connection.");
    await expect(sheet.locator("iframe")).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "Open in Vimeo" })).toBeVisible();
  });
});
