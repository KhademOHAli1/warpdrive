import { taskIdentityIsValid } from "./programmeApproval";
import { inspectFile } from "./programmeFiles";
import {
  type ApprovedTask,
  type Journeys,
  journeyCategories,
  type Ledger,
  type ProgrammeIssue,
} from "./programmeSchemas";

function completionIssues(
  task: Ledger["tasks"][number],
  current: Map<string, Ledger["tasks"][number]>,
): ProgrammeIssue[] {
  const issues: ProgrammeIssue[] = [];
  if (task.status !== "complete") return issues;
  if (task.evidence.length === 0)
    issues.push({
      code: "completion-evidence",
      path: task.id,
      message: "Completion requires existing evidence with a declared level.",
    });
  if (task.remainingGates.length > 0)
    issues.push({
      code: "completion-gates",
      path: task.id,
      message: "Completion cannot retain unresolved gates.",
    });
  if (task.dependsOn.some((id) => current.get(id)?.status !== "complete"))
    issues.push({
      code: "completion-dependency",
      path: task.id,
      message: "Completion requires completed approved dependencies.",
    });
  return issues;
}

export function verifyTasks(
  root: string,
  ledger: Ledger,
  approved: ApprovedTask[],
  signal: AbortSignal,
): ProgrammeIssue[] {
  const issues: ProgrammeIssue[] = [];
  if (!taskIdentityIsValid(ledger.tasks))
    issues.push({
      code: "task-set",
      path: "task-ledger.json",
      message: "Task identities must match all 128 approved tasks and projects.",
    });
  const baseline = new Map(approved.map((task) => [task.id, task]));
  const current = new Map(ledger.tasks.map((task) => [task.id, task]));
  for (const task of ledger.tasks) {
    const reference = baseline.get(task.id);
    if (
      reference === undefined ||
      reference.dependsOn.length !== task.dependsOn.length ||
      reference.dependsOn.some((id) => !task.dependsOn.includes(id))
    )
      issues.push({
        code: "dependency",
        path: task.id,
        message: "Dependencies differ from the approved task CSV.",
      });
    for (const evidence of task.evidence) {
      const inspected = inspectFile(root, evidence.path, signal);
      if (!inspected.ok) issues.push(inspected.error);
    }
    issues.push(...completionIssues(task, current));
  }
  return issues;
}

export function verifyJourneys(
  root: string,
  registry: Journeys,
  ledger: Ledger,
  signal: AbortSignal,
): ProgrammeIssue[] {
  const issues: ProgrammeIssue[] = [];
  const categories = registry.journeys.map((journey) => journey.id);
  if (
    new Set(categories).size !== categories.length ||
    journeyCategories.some((id) => !categories.includes(id))
  )
    issues.push({
      code: "journey-set",
      path: "critical-journeys.json",
      message: "All twelve protected journey categories must be registered uniquely.",
    });
  const ids = new Set(ledger.tasks.map((task) => task.id));
  for (const journey of registry.journeys) {
    if (journey.taskIds.some((id) => !ids.has(id)))
      issues.push({
        code: "journey-task",
        path: journey.id,
        message: "Journey references an unknown task.",
      });
    for (const path of [...journey.sourceTests, ...journey.fixtures]) {
      const inspected = inspectFile(root, path, signal);
      if (!inspected.ok) issues.push(inspected.error);
    }
    if (journey.sourceTests.some((path) => !/\.test\.tsx?$/.test(path)))
      issues.push({
        code: "journey-test",
        path: journey.id,
        message: "Source tests must identify actual test files, not test counts.",
      });
  }
  return issues;
}
