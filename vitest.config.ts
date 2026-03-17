import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@agentloop/core": resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@agentloop/core/test": resolve(import.meta.dirname, "packages/core/src/test.ts"),
    },
  },
});
