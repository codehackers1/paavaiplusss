import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
// Forward slashes keep the alias valid on Windows.
const rootAlias = rootDir.replace(/\\/g, "/") + "/";

export default defineConfig({
  resolve: {
    // Only rewrite "@/..." specifiers — never "@prisma/client" or other scoped
    // packages. A plain "@" key would corrupt scoped imports.
    alias: [{ find: /^@\//, replacement: rootAlias }],
  },
  test: {
    environment: "node",
    globals: false,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
    // Deterministic environment for pure-logic tests, independent of the
    // developer's shell or a .env file.
    env: {
      APP_TIMEZONE: "Asia/Kolkata",
      AUDIT_HASH_PEPPER: "unit-test-pepper",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts"],
      // The DB-backed service layer is exercised by the (DB-gated) integration
      // suite and end-to-end tests, not by pure unit coverage.
      exclude: ["lib/db/**", "lib/services/**", "lib/**/*.d.ts"],
    },
  },
});
