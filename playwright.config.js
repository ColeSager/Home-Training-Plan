import { defineConfig } from "@playwright/test";

const base = process.env.BASE_URL;
const phone = { viewport: { width: 390, height: 844 }, serviceWorkers: "block" };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: base ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: base ?? "http://127.0.0.1:4174/", ...phone },
  projects: [
    { name: "chromium", use: { browserName: "chromium", ...phone } },
    { name: "webkit", use: { browserName: "webkit", ...phone } },
  ],
  webServer: base
    ? undefined
    : { command: "python3 -m http.server 4174 --bind 127.0.0.1", url: "http://127.0.0.1:4174/", reuseExistingServer: true, stderr: "ignore" },
});
