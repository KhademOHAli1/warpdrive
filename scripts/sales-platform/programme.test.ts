import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProgramme } from "./programme";

const temporaryRoots: string[] = [];
const files = [
  "INTEGRATION-SAFETY.md",
  "PRD-Warpdrive-Sales-Process-Platform.md",
  "PROJECTS.md",
  "README.md",
  "SOURCES-AND-DECISIONS.md",
  "UX-RESEARCH.md",
  "TASKS.csv",
];
const categories = [
  "auth",
  "pipeline-access",
  "records",
  "saved-views",
  "exports",
  "workflows",
  "communications",
  "regional-dates",
  "regional-money",
  "regional-phones",
  "recovery",
  "workspace-isolation",
];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wd-programme-test-"));
  temporaryRoots.push(root);
  const directory = join(root, "docs/sales-platform");
  mkdirSync(join(directory, "approved"), { recursive: true });
  const tasks = Array.from({ length: 128 }, (_, index) => {
    const projectId = `SP-${Math.floor(index / 8)
      .toString()
      .padStart(2, "0")}`;
    return {
      id: `${projectId}.${(index % 8) + 1}`,
      projectId,
      status: "planned",
      owner: "sales-platform",
      dependsOn: index === 1 ? ["SP-00.1"] : [],
      evidence: [] as { path: string; level: string }[],
      remainingGates: [] as string[],
      notes: "",
    };
  });
  const csv = `\uFEFFtask_id,project_id,depends_on\r\n${tasks.map((task) => `${task.id},${task.projectId},${task.dependsOn.join("; ")}`).join("\r\n")}\r\n`;
  const manifestFiles = files.map((path) => {
    const content = path === "TASKS.csv" ? csv : `Approved ${path}\n`;
    writeFileSync(join(directory, "approved", path), content);
    return { path, bytes: Buffer.byteLength(content), sha256: sha256(content) };
  });
  const manifest = JSON.stringify({
    projects: 16,
    tasks: 128,
    ux_studies: 20,
    files: manifestFiles,
  });
  writeFileSync(join(directory, "approved/MANIFEST.json"), manifest);
  const ledger = {
    schemaVersion: 1,
    baselineCommit: "a".repeat(40),
    approvedManifestSha256: sha256(manifest),
    tasks,
  };
  const journeys = {
    schemaVersion: 1,
    journeys: categories.map((id) => ({
      id,
      owner: "sales-platform",
      taskIds: ["SP-00.1"],
      surfaces: ["server"],
      sourceTests: ["source.test.ts"],
      fixtures: [],
      pendingGates: ["Exact candidate runtime not run"],
    })),
  };
  writeFileSync(join(root, "source.test.ts"), "// Fixture test reference\n");
  const save = () => {
    writeFileSync(join(directory, "task-ledger.json"), JSON.stringify(ledger));
    writeFileSync(join(directory, "critical-journeys.json"), JSON.stringify(journeys));
  };
  save();
  const [firstTask, secondTask] = ledger.tasks;
  const [firstJourney] = journeys.journeys;
  if (firstTask === undefined || secondTask === undefined || firstJourney === undefined)
    throw new Error("Fixture is incomplete");
  return { root, directory, ledger, journeys, save, firstTask, secondTask, firstJourney };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function issueCodes(root: string) {
  const result = await verifyProgramme(root, AbortSignal.timeout(5000));
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error.map((issue) => issue.code);
}

describe("programme evidence guard", () => {
  it("verifies all approved hashes, task identities and explicit pending journey gates", async () => {
    const { root } = fixture();
    const result = await verifyProgramme(root, AbortSignal.timeout(5000));
    expect(result).toEqual({
      ok: true,
      value: {
        tasks: 128,
        projects: 16,
        complete: 0,
        journeys: 12,
        evidenceCeiling: "Register integrity only; no acceptance is inferred.",
      },
    });
  });

  it("detects changes to approved content", async () => {
    const { root, directory } = fixture();
    writeFileSync(join(directory, "approved/README.md"), "changed");
    expect(await issueCodes(root)).toContain("content-hash");
  });

  it("detects a replaced approval manifest even if its content hashes were updated", async () => {
    const { root, directory } = fixture();
    const path = join(directory, "approved/MANIFEST.json");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    expect(await issueCodes(root)).toContain("manifest-hash");
  });

  it.each(["missing", "duplicate", "wrong-project"])(
    "rejects %s task identities",
    async (variant) => {
      const f = fixture();
      if (variant === "missing") f.ledger.tasks.pop();
      if (variant === "duplicate") f.ledger.tasks[1] = structuredClone(f.firstTask);
      if (variant === "wrong-project") f.firstTask.projectId = "SP-01";
      f.save();
      expect(await issueCodes(f.root)).toContain("task-set");
    },
  );

  it("rejects dependencies edited away from the approved CSV", async () => {
    const f = fixture();
    f.secondTask.dependsOn = [];
    f.save();
    expect(await issueCodes(f.root)).toContain("dependency");
  });

  it("requires actual evidence and no remaining gates before completion", async () => {
    const f = fixture();
    f.firstTask.status = "complete";
    f.firstTask.remainingGates = ["Browser journey not run"];
    f.save();
    const codes = await issueCodes(f.root);
    expect(codes).toContain("completion-evidence");
    expect(codes).toContain("completion-gates");
  });

  it("requires completion of dependencies independently of evidence counts", async () => {
    const f = fixture();
    f.secondTask.status = "complete";
    f.secondTask.evidence = [{ path: "docs/sales-platform/result.json", level: "local-unit" }];
    writeFileSync(join(f.directory, "result.json"), "{}");
    f.save();
    expect(await issueCodes(f.root)).toContain("completion-dependency");
  });

  it("accepts scoped existing evidence without upgrading its evidence level", async () => {
    const f = fixture();
    f.firstTask.status = "complete";
    f.firstTask.evidence = [{ path: "docs/sales-platform/result.json", level: "observed-source" }];
    writeFileSync(join(f.directory, "result.json"), "{}");
    f.save();
    const result = await verifyProgramme(f.root, AbortSignal.timeout(5000));
    expect(result.ok && result.value.complete).toBe(1);
  });

  it.each([
    "../outside.json",
    "/tmp/outside.json",
    ".env",
    "docs/secrets/result.json",
    "docs/sales-platform/key.pem",
  ])("refuses unsafe evidence path %s", async (path) => {
    const f = fixture();
    f.firstTask.evidence = [{ path, level: "observed-source" }];
    f.save();
    expect(await issueCodes(f.root)).toContain("unsafe-path");
  });

  it("rejects symbolic links even when the displayed path is inside the evidence directory", async () => {
    const f = fixture();
    symlinkSync(join(f.root, "source.test.ts"), join(f.directory, "linked.json"));
    f.firstTask.evidence = [{ path: "docs/sales-platform/linked.json", level: "local-unit" }];
    f.save();
    expect(await issueCodes(f.root)).toContain("unsafe-path");
  });

  it("reports missing evidence without reading it", async () => {
    const f = fixture();
    f.firstTask.evidence = [{ path: "docs/sales-platform/missing.json", level: "local-runtime" }];
    f.save();
    expect(await issueCodes(f.root)).toContain("missing-file");
  });

  it("requires all protected journey categories, existing source tests and known task IDs", async () => {
    const f = fixture();
    f.journeys.journeys.pop();
    f.firstJourney.sourceTests = ["missing.test.ts"];
    f.firstJourney.taskIds = ["SP-99.1"];
    f.save();
    const codes = await issueCodes(f.root);
    expect(codes).toContain("journey-set");
    expect(codes).toContain("missing-file");
    expect(codes).toContain("journey-task");
  });

  it("rejects malformed JSON and unrecognized evidence levels", async () => {
    const f = fixture();
    f.firstTask.evidence = [{ path: "docs/sales-platform/result.json", level: "passed" }];
    f.save();
    expect(await issueCodes(f.root)).toContain("schema");
    writeFileSync(join(f.directory, "task-ledger.json"), "{");
    expect(await issueCodes(f.root)).toContain("schema");
  });

  it("respects cancellation before reading files", async () => {
    const { root } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(verifyProgramme(root, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
