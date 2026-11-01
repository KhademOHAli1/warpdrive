import type { Locale } from "@/features/i18n/registry";
import german from "./messages/workflows.de.json";
import english from "./messages/workflows.en.json";
import persian from "./messages/workflows.fa.json";
import type { WorkflowNode } from "./schemas";

export const nodeLabelKeys = {
  "trigger.manual": "start",
  "trigger.record": "start",
  "record.read": "read",
  "activity.create": "task",
  condition: "condition",
  delay: "delay",
  notification: "notification",
} as const;
const catalogs = { en: english, fa: persian, de: german };
export function displayNodeName(node: WorkflowNode, locale: Locale): string {
  const key = nodeLabelKeys[node.type];
  if (node.nameMode === "custom") return node.name;
  // Legacy drafts did not distinguish generated labels from custom names. Recognize
  // exact catalog defaults for display, preserving the stored text and other names.
  const automatic = isAutomaticNodeName(node);
  return automatic ? catalogs[locale][key] : node.name;
}
export function isAutomaticNodeName(node: WorkflowNode): boolean {
  return (
    node.nameMode !== "custom" &&
    (node.nameMode === "automatic" ||
      Object.values(catalogs).some((messages) => messages[nodeLabelKeys[node.type]] === node.name))
  );
}
