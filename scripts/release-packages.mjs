import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// CLI first prevents a lingering first-publish name reservation from leaving an SDK-only release.
const releasePackages = ["unigent-cli", "unigent-sdk"];

const releaseVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
}

export { releasePackages, releaseVersion, run };
