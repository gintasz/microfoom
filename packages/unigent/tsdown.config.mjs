import { defineConfig } from "tsdown";

// biome-ignore lint/style/noDefaultExport: tsdown discovers its configuration via a default export.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    args: "src/args.ts",
    mcp: "src/mcp.ts",
    test: "src/test.ts",
    tools: "src/tools.ts",
    trace: "src/trace.ts",
  },
  clean: true,
  dts: {
    resolver: "tsc",
  },
  format: "esm",
  fixedExtension: false,
  platform: "node",
  sourcemap: true,
  target: "node24",
});
