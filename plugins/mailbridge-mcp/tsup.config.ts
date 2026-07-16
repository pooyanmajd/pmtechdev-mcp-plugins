import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: true,
  minify: false,
  clean: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
