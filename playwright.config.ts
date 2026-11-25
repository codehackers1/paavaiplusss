import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * End-to-end tests need a running application AND a live PostgreSQL database.
 * When E2E_BASE_URL is not provided, the specs self-skip (see tests/e2e) so the
 * command is safe in environments without infrastructure.
 *
 * To run for real:
 *   1. Provision PostgreSQL and set DATABASE_URL (and TEST_DATABASE_URL).
 *   2. `npm run prisma:migrate:dev` then `npm run prisma:seed`.
 *   3. `npm run build && npm run start` (or let `webServer` do it).
 *   4. `E2E_BASE_URL=http://localhost:3000 npm run test:e2e`
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
