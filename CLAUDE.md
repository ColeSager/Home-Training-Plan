# Home-Training-Plan

Static phone web app on GitHub Pages: a 36-session home training plan for a couple, with on-device logging.

## Code comment standard

Comment only when the code is deliberately non-obvious, a caller needs a unit, ownership or range the signature can't say, or an unenforceable rule must be kept. The bar for keeping a comment: would a competent stranger make a wrong change without the line? Python docstrings are one line. No narration, change history, reasoning prose, banners, attribution, dates, decision-log IDs, commented-out code or idle TODOs.

Decisions, reasoning and measured traps go in an append-only `../Home-Training-Plan-decisions/DECISIONS.md` (D-001, D-002, ...) beside the repo, outside it and outside cloud-synced folders. The log points at code, never the reverse. Testable traps become tests. Claude Code handoff prompts for this repo must include this standard.

## Rules

- No framework, no build step, no runtime dependencies. Playwright is dev-only.
- No em or en dashes anywhere: code, copy, commits, docs. A unit test scans the repo.
- `data/plan.json` is generated outside the repo. Never edit workout text by hand.
- Log keys are `"<n>-<piece type>"` and must not depend on workout text.
- Never commit anything from `~/ClaudeScratch/Couple_Home_Plan/tools/`, the `.xlsx`, or the mock-up files.

## Plan updates

Replace `data/plan.json`, bump `VERSION` in `sw.js`, run the tests, push to `main`.

## Run

```bash
npm install && npx playwright install chromium webkit
npm test
npm run serve
BASE_URL=https://colesager.github.io/Home-Training-Plan/ npx playwright test
```
