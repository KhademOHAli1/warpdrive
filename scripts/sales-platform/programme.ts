import { err, ok, type Result } from "@/types/result";
import { parseJson, programmeDirectory, verifyApproval } from "./programmeApproval";
import { readProgrammeFile } from "./programmeFiles";
import { verifyJourneys, verifyTasks } from "./programmePolicy";
import { journeysSchema, ledgerSchema, type ProgrammeIssue } from "./programmeSchemas";

interface ProgrammeReport {
  tasks: number;
  projects: number;
  complete: number;
  journeys: number;
  evidenceCeiling: string;
}

export async function verifyProgramme(
  root: string,
  signal: AbortSignal,
): Promise<Result<ProgrammeReport, ProgrammeIssue[]>> {
  signal.throwIfAborted();
  const ledgerPath = `${programmeDirectory}/task-ledger.json`;
  const ledgerFile = await readProgrammeFile(root, ledgerPath, signal);
  if (!ledgerFile.ok) return err([ledgerFile.error]);
  const ledger = ledgerSchema.safeParse(parseJson(ledgerFile.value));
  if (!ledger.success)
    return err([{ code: "schema", path: ledgerPath, message: "Invalid task ledger." }]);
  const approved = await verifyApproval(root, ledger.data.approvedManifestSha256, signal);
  if (!approved.ok) return approved;
  const registryPath = `${programmeDirectory}/critical-journeys.json`;
  const registryFile = await readProgrammeFile(root, registryPath, signal);
  if (!registryFile.ok) return err([registryFile.error]);
  const registry = journeysSchema.safeParse(parseJson(registryFile.value));
  if (!registry.success)
    return err([
      { code: "schema", path: registryPath, message: "Invalid protected-journey registry." },
    ]);
  const issues = [
    ...verifyTasks(root, ledger.data, approved.value, signal),
    ...verifyJourneys(root, registry.data, ledger.data, signal),
  ];
  if (issues.length > 0) return err(issues);
  return ok({
    tasks: ledger.data.tasks.length,
    projects: new Set(ledger.data.tasks.map((task) => task.projectId)).size,
    complete: ledger.data.tasks.filter((task) => task.status === "complete").length,
    journeys: registry.data.journeys.length,
    evidenceCeiling: "Register integrity only; no acceptance is inferred.",
  });
}
