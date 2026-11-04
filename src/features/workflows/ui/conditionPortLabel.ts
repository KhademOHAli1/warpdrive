import type { WorkflowEdge } from "../schemas";
export function conditionPortLabel(port: WorkflowEdge["port"]) {
  if (port === "false") return "conditionOtherwise";
  return port === "true" ? "truePort" : "nextPort";
}
