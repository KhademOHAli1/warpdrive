import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { inspectGraph } from "./graph";
import { branchPort, ifElsePorts } from "./ifElseBudget";
import type { StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./schemas";

function selectIfElseBranch(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  output: StepOutput,
): Result<WorkflowEdge | undefined, string> {
  if (
    !Object.hasOwn(output, "matchingBranchId") ||
    typeof output.matchingBranchId !== "string" ||
    inspectGraph(definition).length !== 0
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const port = branchPort(output.matchingBranchId);
  if (!ifElsePorts(node.config).includes(port)) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok(definition.edges.find((edge) => edge.from === node.id && edge.port === port));
}

// Predicate steps have no external/database effect, so malformed stored branches can
// fail before its receipt/cursor commit. Ordinary nodes retain their existing
// terminal/next behavior; this introduces no new failure after an activity write.
export function selectRunBranch(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  output: StepOutput,
): Result<WorkflowEdge | undefined, string> {
  if (node.type === "ifElse") return selectIfElseBranch(definition, node, output);
  if (node.type === "filter") {
    if (
      !Object.hasOwn(output, "matchesFilter") ||
      typeof output.matchesFilter !== "boolean" ||
      inspectGraph(definition).length !== 0
    )
      return err(ERROR_IDS.WORKFLOW_INVALID);
    if (!output.matchesFilter) return ok(undefined);
  }
  if (node.type !== "condition")
    return ok(definition.edges.find((edge) => edge.from === node.id && edge.port === "next"));
  if (!Object.hasOwn(output, "result") || typeof output.result !== "boolean")
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (inspectGraph(definition).length !== 0) return err(ERROR_IDS.WORKFLOW_INVALID);
  const port = output.result ? "true" : "false";
  const matches = definition.edges.filter((edge) => edge.from === node.id && edge.port === port);
  const edge = matches[0];
  return matches.length === 1 && edge !== undefined ? ok(edge) : err(ERROR_IDS.WORKFLOW_INVALID);
}
