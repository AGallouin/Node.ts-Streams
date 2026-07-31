import { defineConfig } from "rolldown";

export default defineConfig([
  {
    input: "src/index.ts",
    platform: "node",
    output: {
      dir: "build",
      format: "cjs",
      entryFileNames: "[name].cjs",
      sourcemap: true,
      exports: "auto",
    },
  },
  {
    input: "src/index.ts",
    platform: "node",
    output: {
      dir: "build",
      format: "esm",
      entryFileNames: "[name].mjs",
      sourcemap: true,
    },
  },
]);
