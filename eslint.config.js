// ESLint exists here for ONE job: type-aware rules that need the full TS type
// graph, which Biome 2.5 cannot do (it uses shallow inference). Biome remains the
// primary linter/formatter — do NOT add stylistic, complexity, promise, or import
// rules here; those are Biome's and duplicating them makes two linters fight.
// Everything below is type-flow / type-correctness only.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/worktrees/**",
      "docs-website/**",
      "examples/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
    ],
  },
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    // base registers the parser + plugin with NO rules, so we opt in explicitly.
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        // Explicit project list (not projectService): test files live only in
        // tsconfig.test.json, a non-standard name projectService won't discover.
        project: ["./packages/*/tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      // Type-aware. strict-boolean forces explicit nullish/empty handling;
      // no-unnecessary-condition flags dead conditions — which here means either
      // genuine slop (redundant checks on non-nullable values) or a cast-lie
      // upstream that hid a real runtime check (fix the cast, not the guard).
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      // Type-aware correctness guards (Biome has no equivalent).
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-misused-spread": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
  {
    // Tests interface with `any`-typed mocks and vitest asymmetric matchers
    // (expect.stringContaining, etc.). The no-unsafe-* family guards production
    // type-flow; in tests it only flags idiomatic matcher usage. src stays strict.
    files: ["packages/*/test/**/*.ts", "packages/*/test/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
