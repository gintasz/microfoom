// Installs the repo-managed git hooks (.githooks/*) into the SHARED git hooks dir
// and makes them executable. Run from `prepare`, so every `pnpm install` re-asserts
// our self-healing hooks and overwrites any lefthook-generated template — that
// template ends its binary-discovery chain at a `mint` fallback which breaks fresh
// worktrees. The shared hooks dir (git-common-dir/hooks) is what every worktree
// runs, because the worktree tooling points each worktree's core.hooksPath there.
// Node-only: no shell-quoting pitfalls.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let commonDir;
try {
  commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
} catch {
  // Not a git checkout (e.g. a tarball install in CI) — nothing to wire.
  process.exit(0);
}

const hooksDir = join(commonDir, "hooks");
mkdirSync(hooksDir, { recursive: true });
for (const hook of ["pre-commit", "pre-push"]) {
  const dest = join(hooksDir, hook);
  copyFileSync(join(".githooks", hook), dest);
  chmodSync(dest, 0o755);
}
console.log(`microfoom: installed self-healing git hooks → ${hooksDir}`);
