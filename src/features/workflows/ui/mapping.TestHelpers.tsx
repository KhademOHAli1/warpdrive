import type { ReactNode } from "react";
import { assert, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ConfigurationMetadata } from "../configurationTypes";
import { initialDefinition } from "../editorModel";
import { describeMappingTarget } from "../mappingCatalog";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowDefinition } from "../schemas";

export const mappingLocales = [
  {
    name: "English",
    locale: "en",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    copy: english,
  },
  {
    name: "German",
    locale: "de",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    copy: german,
  },
  {
    name: "Persian",
    locale: "fa",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
    copy: persian,
  },
  {
    name: "Persian Latin",
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "America/Los_Angeles",
    copy: persian,
  },
] as const;
export const completeMappingMetadata: ConfigurationMetadata = { status: "complete", defs: [] };
export function mappingGraph(): WorkflowDefinition {
  const graph = initialDefinition({
    start: "Manual start",
    read: "Opportunity read",
    task: "Create task",
    subject: "Follow up",
  });
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, nameMode: "custom" })) };
}
export function mappingTarget(
  graph = mappingGraph(),
  nodeId = "task",
  path: readonly string[] = ["subject"],
  metadata = completeMappingMetadata,
) {
  const described = describeMappingTarget(graph, nodeId, path, metadata);
  assert(described.state === "ready");
  return described.target;
}
export function prepareMappingDom() {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
}
export function MappingLocale({
  context,
  children,
}: {
  context: (typeof mappingLocales)[number];
  children: ReactNode;
}) {
  return (
    <LocaleProvider
      locale={context.locale}
      calendar={context.calendar}
      numberingSystem={context.numberingSystem}
      timeZone={context.timeZone}
    >
      {children}
    </LocaleProvider>
  );
}
