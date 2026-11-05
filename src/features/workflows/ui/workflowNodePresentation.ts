import type { WorkflowNode } from "../schemas";
import type { WorkflowReferenceIconName } from "./WorkflowReferenceIcon";

export const NODE_ICONS: Record<WorkflowNode["type"], WorkflowReferenceIconName> = {
  "trigger.manual": "hand-move",
  "trigger.record": "playlist-add",
  "record.read": "search",
  "record.create": "plus",
  "record.update": "reload",
  "record.delete": "trash",
  "record.search": "search",
  "record.pick": "arrows-shuffle",
  "email.draft": "mail-plus",
  "calendar.create": "calendar-event",
  "human.form": "forms",
  "activity.create": "plus",
  condition: "arrows-split",
  ifElse: "arrows-split",
  filter: "filter",
  delay: "player-pause",
  notification: "send",
};

export function workflowNodeCategory(type: WorkflowNode["type"]) {
  if (type.startsWith("trigger.")) return "nodeCategoryTrigger";
  if (type === "human.form") return "nodeCategoryHumanInput";
  if (type === "condition" || type === "ifElse" || type === "filter" || type === "delay")
    return "nodeCategoryFlow";
  return type === "notification" || type === "email.draft" || type === "calendar.create"
    ? "nodeCategoryCore"
    : "nodeCategoryData";
}

export function workflowNodeStrokeWidth(type: WorkflowNode["type"]): 1.6 | 2 {
  return type === "record.read" ||
    type === "activity.create" ||
    type === "condition" ||
    type === "ifElse" ||
    type === "record.create" ||
    type === "record.update" ||
    type === "record.delete" ||
    type === "notification"
    ? 1.6
    : 2;
}
