import { createHash } from "node:crypto";
import { err, ok, type Result } from "@/types/result";
import { approvedTasksFromCsv } from "./programmeCsv";
import { readProgrammeFile } from "./programmeFiles";
import {
  type ApprovedTask,
  approvedFiles,
  manifestSchema,
  type ProgrammeIssue,
} from "./programmeSchemas";

export const programmeDirectory = "docs/sales-platform";
export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function parseJson(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function hasCycle(tasks: ApprovedTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): boolean {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    active.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (visit(dependency)) return true;
    active.delete(id);
    visited.add(id);
    return false;
  }
  return tasks.some((task) => visit(task.id));
}

export function taskIdentityIsValid(tasks: { id: string; projectId: string }[]): boolean {
  if (tasks.length !== 128 || new Set(tasks.map((task) => task.id)).size !== 128) return false;
  for (let project = 0; project < 16; project++) {
    const projectId = `SP-${project.toString().padStart(2, "0")}`;
    for (let item = 1; item <= 8; item++) {
      if (!tasks.some((task) => task.id === `${projectId}.${item}` && task.projectId === projectId))
        return false;
    }
  }
  return true;
}

async function inspectApprovedContent(
  root: string,
  entries: { path: string; bytes: number; sha256: string }[],
  signal: AbortSignal,
) {
  const issues: ProgrammeIssue[] = [];
  let csv: Buffer | undefined;
  for (const entry of entries) {
    const path = `${programmeDirectory}/approved/${entry.path}`;
    const content = await readProgrammeFile(root, path, signal);
    if (!content.ok) {
      issues.push(content.error);
      continue;
    }
    if (sha256(content.value) !== entry.sha256 || content.value.length !== entry.bytes)
      issues.push({
        code: "content-hash",
        path,
        message: "Approved file bytes differ from its manifest.",
      });
    if (entry.path === "TASKS.csv") csv = content.value;
  }
  return { issues, csv };
}

export async function verifyApproval(
  root: string,
  expectedDigest: string,
  signal: AbortSignal,
): Promise<Result<ApprovedTask[], ProgrammeIssue[]>> {
  const path = `${programmeDirectory}/approved/MANIFEST.json`;
  const file = await readProgrammeFile(root, path, signal);
  if (!file.ok) return err([file.error]);
  const issues: ProgrammeIssue[] = [];
  if (sha256(file.value) !== expectedDigest)
    issues.push({
      code: "manifest-hash",
      path,
      message: "The approval manifest differs from the recorded baseline.",
    });
  const manifest = manifestSchema.safeParse(parseJson(file.value));
  if (!manifest.success)
    return err([...issues, { code: "schema", path, message: "Invalid approved manifest." }]);
  const names = manifest.data.files.map((entry) => entry.path);
  if (
    new Set(names).size !== approvedFiles.length ||
    approvedFiles.some((name) => !names.includes(name))
  )
    return err([
      ...issues,
      {
        code: "manifest-set",
        path,
        message: "The approved package must contain exactly seven named content files.",
      },
    ]);
  const content = await inspectApprovedContent(root, manifest.data.files, signal);
  issues.push(...content.issues);
  if (content.csv === undefined) return err(issues);
  const parsed = approvedTasksFromCsv(content.csv.toString("utf8"));
  if (!parsed.ok)
    return err([
      ...issues,
      { code: "schema", path: "TASKS.csv", message: "Approved task CSV is malformed." },
    ]);
  if (!taskIdentityIsValid(parsed.value))
    issues.push({
      code: "task-set",
      path: "TASKS.csv",
      message: "The approval requires 128 unique tasks, eight in each of sixteen projects.",
    });
  const ids = new Set(parsed.value.map((task) => task.id));
  if (
    parsed.value.some((task) => task.dependsOn.some((dependency) => !ids.has(dependency))) ||
    hasCycle(parsed.value)
  )
    issues.push({
      code: "dependency",
      path: "TASKS.csv",
      message: "Approved dependencies must resolve and be acyclic.",
    });
  return issues.length === 0 ? ok(parsed.value) : err(issues);
}
