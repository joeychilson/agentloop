import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/test.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
});
