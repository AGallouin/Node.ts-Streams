import typescript from "@rollup/plugin-typescript";
import externals from "rollup-plugin-node-externals";

export default {
  input: "src/index.ts",
  output: {
    dir: "build",
    format: "cjs",
    sourcemap: true,
    exports: "auto",
    interop: "compat",
  },
  plugins: [
    externals(),
    typescript({
      tsconfig: "./tsconfig.json",
      noEmitOnError: process.env.CI === "true",
    }),
  ],
};
