import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADVISORY_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const FAILING_SEVERITIES = new Set(["high", "critical"]);
const SEVERITY_ORDER = new Map([
  ["unknown", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);
const DEPENDENCY_GROUPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "unsavedDependencies",
];

function installedDependencyInventory() {
  const output = execFileSync(
    "corepack",
    ["pnpm", "list", "--recursive", "--json", "--depth", "Infinity"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const projects = JSON.parse(output);
  const inventory = new Map();

  function visitDependency(name, dependency) {
    if (
      typeof dependency.version === "string" &&
      !dependency.version.startsWith("link:") &&
      typeof dependency.resolved === "string" &&
      dependency.resolved.startsWith("https://registry.npmjs.org/")
    ) {
      const versions = inventory.get(name) ?? new Set();
      versions.add(dependency.version);
      inventory.set(name, versions);
    }
    for (const group of DEPENDENCY_GROUPS) {
      for (const [childName, child] of Object.entries(dependency[group] ?? {})) {
        visitDependency(childName, child);
      }
    }
  }

  for (const project of projects) {
    for (const group of DEPENDENCY_GROUPS) {
      for (const [name, dependency] of Object.entries(project[group] ?? {})) {
        visitDependency(name, dependency);
      }
    }
  }

  return Object.fromEntries(
    [...inventory]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()]),
  );
}

function parseAdvisories(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("npm bulk advisory response is not an object");
  }
  const advisories = [];
  for (const [packageName, packageAdvisories] of Object.entries(value)) {
    if (!Array.isArray(packageAdvisories)) {
      throw new TypeError(`npm advisories for ${packageName} are not an array`);
    }
    for (const advisory of packageAdvisories) {
      if (
        advisory === null ||
        typeof advisory !== "object" ||
        typeof advisory.id !== "number" ||
        typeof advisory.severity !== "string" ||
        !SEVERITY_ORDER.has(advisory.severity) ||
        typeof advisory.title !== "string" ||
        typeof advisory.url !== "string"
      ) {
        throw new TypeError(`npm returned a malformed advisory for ${packageName}`);
      }
      advisories.push({ packageName, ...advisory });
    }
  }
  return advisories.sort(
    (left, right) =>
      SEVERITY_ORDER.get(right.severity) - SEVERITY_ORDER.get(left.severity) ||
      left.packageName.localeCompare(right.packageName) ||
      left.id - right.id,
  );
}

const inventory = installedDependencyInventory();
const response = await fetch(ADVISORY_ENDPOINT, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify(inventory),
});
if (!response.ok) {
  throw new Error(`npm bulk advisory request failed: HTTP ${response.status}`);
}
const advisories = parseAdvisories(await response.json());
for (const advisory of advisories) {
  process.stdout.write(
    `[${advisory.severity}] ${advisory.packageName}: ${advisory.title} (${advisory.url})\n`,
  );
}
const failures = advisories.filter((advisory) => FAILING_SEVERITIES.has(advisory.severity));
if (failures.length > 0) {
  throw new Error(`dependency audit found ${failures.length} high or critical advisories`);
}
const versionCount = Object.values(inventory).reduce(
  (total, versions) => total + versions.length,
  0,
);
process.stdout.write(
  `dependency audit passed (${Object.keys(inventory).length} packages, ${versionCount} versions, ${advisories.length} advisories below high)\n`,
);
