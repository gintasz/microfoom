import process from "node:process";
import { releasePackages, releaseVersion, run } from "./release-packages.mjs";

run(process.execPath, ["scripts/verify-release.mjs"]);

for (const packageName of releasePackages) {
  run("npm", ["dist-tag", "add", `${packageName}@${releaseVersion}`, "latest"]);
}

run(process.execPath, ["scripts/verify-release.mjs", "--latest"]);
