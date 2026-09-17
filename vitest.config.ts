import { defineConfig } from "vitest/config";


export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          environment: "node",
          testTimeout: 120_000,
          // One fork, one clock: the files share surfpool state and time travel, so they must not interleave.
          fileParallelism: false,
          sequence: { concurrent: false }
        }
      }
    ]
  }
});
