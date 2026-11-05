import type { WorkflowNode } from "../schemas";
import type { WorkflowReferenceIconName } from "./WorkflowReferenceIcon";

export const NODE_ICONS: Record<WorkflowNode["type"], WorkflowReferenceIconName> = {
  "trigger.manual": "hand-move",
  "trigger.record": "playlist-add",
  "record.read": "search",
  "activity.create": "plus",
  condition: "arrows-split",
  filter: "filter",
  delay: "player-pause",
  notification: "send",
};

export function workflowNodeCategory(type: WorkflowNode["type"]) {
  if (type.startsWith("trigger.")) return "nodeCategoryTrigger";
  if (type === "condition" || type === "filter" || type === "delay") return "nodeCategoryFlow";
  return type === "notification" ? "nodeCategoryCore" : "nodeCategoryData";
}

export function workflowNodeStrokeWidth(type: WorkflowNode["type"]): 1.6 | 2 {
  return type === "record.read" ||
    type === "activity.create" ||
    type === "condition" ||
    type === "notification"
    ? 1.6
    : 2;
}
