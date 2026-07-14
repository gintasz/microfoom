import process from "node:process";
import { releasePackages, releaseVersion, run } from "./release-packages.mjs";

const REGISTRY_ROOT = "https://registry.npmjs.org";

async function fetchPackument(packageName) {
  const response = await fetch(
    `${REGISTRY_ROOT}/${encodeURIComponent(packageName)}?release=${releaseVersion}-${Date.now()}`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`registry lookup failed for ${packageName}: HTTP ${response.status}`);
  }
  return response.json();
}

run("corepack", ["pnpm", "run", "build"]);
run("corepack", ["pnpm", "run", "package:check"]);

try {
  run(process.execPath, ["scripts/sync-package-docs.mjs"]);
  for (const packageName of releasePackages) {
    const packument = await fetchPackument(packageName);
    if (packument?.versions?.[releaseVersion] !== undefined) {
      if (packument["dist-tags"]?.latest !== releaseVersion) {
        throw new Error(
          `${packageName}@${releaseVersion} exists but is not latest; recover its dist-tag manually`,
        );
      }
      process.stdout.write(`publish: ${packageName}@${releaseVersion} already latest\n`);
      continue;
    }
    run("corepack", [
      "pnpm",
      "--config.node-linker=hoisted",
      "--filter",
      packageName,
      "publish",
      "--access",
      "public",
      "--tag",
      "latest",
      "--no-git-checks",
    ]);
  }
} finally {
  run(process.execPath, ["scripts/sync-package-docs.mjs", "--clean"]);
}

run(process.execPath, ["scripts/verify-release.mjs", "--latest"]);
