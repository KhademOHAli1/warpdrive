import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SELECTABLE_LOCALES } from "../../src/features/i18n/registry";
import { auditCatalogs } from "./auditCatalogs";
import { auditSource, type SourceFinding } from "./auditSource";
import { partitionReviewedSources } from "./reviewedSource";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = resolve(root, "scripts/i18n/source-baseline.json");
const baselineSchema = z.object({ version: z.literal(1), findings: z.array(z.string()) });
const exceptionsPath = resolve(root, "scripts/i18n/translation-exceptions.json");
const exceptionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), z.string().min(10))),
);
const args = new Set(process.argv.slice(2));
const sourceReviewsSchema = z.object({
  version: z.literal(1),
  findings: z.array(
    z.object({
      id: z.string().min(1),
      file: z.string().min(1),
      text: z.string().min(1),
      reason: z.string().min(10),
    }),
  ),
});

function projectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (["primitives", "__tests__", "__fixtures__"].includes(entry.name)) return [];
      return projectFiles(path);
    }
    if (!entry.isFile()) return [];
    return [path];
  });
}

function loadCatalogGroups(files: string[]): Map<string, Record<string, unknown>> {
  const groups = new Map<string, Record<string, unknown>>();
  for (const path of files
    .filter((file) => file.includes("/messages/") && file.endsWith(".json"))
    .sort()) {
    const projectPath = relative(root, path);
    const match = /^(.*\/)(?:([^/]+)\.)?([a-z]{2}(?:-[A-Z]{2})?)\.json$/.exec(projectPath);
    if (match === null) continue;
    const group = `${match[1]}${match[2] ?? ""}`;
    const locale = match[3];
    if (locale === undefined) continue;
    const catalogs = groups.get(group) ?? {};
    catalogs[locale] = JSON.parse(readFileSync(path, "utf8"));
    groups.set(group, catalogs);
  }
  return groups;
}

function run(): number {
  const files = projectFiles(resolve(root, "src"));
  const groups = loadCatalogGroups(files);
  const exceptions = exceptionsSchema.parse(JSON.parse(readFileSync(exceptionsPath, "utf8")));
  const catalogIssues = [...groups].flatMap(([group, catalogs]) => {
    const reviewed = Object.fromEntries(
      Object.entries(exceptions[group] ?? {}).map(([locale, keys]) => [
        locale,
        new Set(Object.keys(keys)),
      ]),
    );
    const issues = auditCatalogs(catalogs, "en", reviewed);
    for (const locale of SELECTABLE_LOCALES) {
      if (!(locale in catalogs))
        issues.push({
          locale,
          key: "",
          code: "invalid-value",
          message: "Required catalog is missing.",
        });
    }
    return issues.map((issue) => ({ ...issue, key: `${group}:${issue.key}` }));
  });
  if (groups.size === 0)
    catalogIssues.push({
      locale: "en",
      key: "",
      code: "invalid-value",
      message: "No message catalogs found.",
    });
  const sourceFindings: SourceFinding[] = files
    .filter(
      (path) =>
        /\.(ts|tsx)$/.test(path) &&
        !/\.(test|spec)\./.test(path) &&
        !/\.d\.(?:json\.)?ts$/.test(path),
    )
    .filter((path) => !relative(root, path).startsWith("src/constants/"))
    .flatMap((path) => auditSource(readFileSync(path, "utf8"), relative(root, path)))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const sourceReviews = sourceReviewsSchema.parse(
    JSON.parse(readFileSync(resolve(root, "scripts/i18n/source-exceptions.json"), "utf8")),
  );
  const partition = partitionReviewedSources(sourceFindings, sourceReviews.findings);
  if (partition.stale.length > 0) {
    for (const review of partition.stale)
      console.error(`Stale reviewed source exception: ${review.file}`);
    return 1;
  }
  const findings = partition.remaining;

  if (args.has("--write-baseline")) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ version: 1, findings: findings.map((finding) => finding.id).sort() }, null, 2)}\n`,
    );
  }
  const baseline = existsSync(baselinePath)
    ? baselineSchema.parse(JSON.parse(readFileSync(baselinePath, "utf8")))
    : { version: 1 as const, findings: [] };
  const known = new Set(baseline.findings);
  const newFindings = findings.filter((finding) => !known.has(finding.id));
  const summary = {
    catalogs: [...groups].map(([group, catalogs]) => ({ group, locales: Object.keys(catalogs) })),
    catalogIssues: catalogIssues.length,
    sourceLiteralCandidates: findings.filter((finding) => finding.kind === "literal").length,
    legacyCatalogImports: findings.filter((finding) => finding.kind === "legacy-catalog").length,
    sourceFilesWithFindings: new Set(findings.map((finding) => finding.file)).size,
    newSourceFindings: newFindings.length,
    reviewedSourceExceptions: partition.reviewed.length,
    sourceMigrationComplete: findings.length === 0,
    note: "Static inventory is a migration aid. Computed copy, backend errors, data labels and browser workflows still require feature review. A valid catalog does not prove that every screen is translated.",
  };
  if (args.has("--report")) {
    writeFileSync(
      resolve(root, "docs/i18n-inventory.json"),
      `${JSON.stringify({ summary, catalogIssues, findings, reviewedSources: partition.reviewed }, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  for (const issue of catalogIssues.slice(0, 30))
    console.error(`${issue.locale}:${issue.key} [${issue.code}] ${issue.message}`);
  if (args.has("--check") && newFindings.length > 0) {
    for (const finding of newFindings.slice(0, 20))
      console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`);
  }
  if (catalogIssues.length > 0) return 1;
  if (args.has("--strict") && findings.length > 0) return 1;
  if (args.has("--check") && newFindings.length > 0) return 1;
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Localization audit failed.");
  process.exitCode = 1;
}
