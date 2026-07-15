import { defineConfig } from "tsdown";

// biome-ignore lint/style/noDefaultExport: tsdown discovers its configuration via a default export.
export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    register: "src/register.ts",
    tui: "src/tui.tsx",
  },
  clean: true,
  dts: false,
  format: "esm",
  fixedExtension: false,
  platform: "node",
  sourcemap: true,
  target: "node24",
});
