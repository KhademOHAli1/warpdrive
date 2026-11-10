import {
  findPaletteEntry,
  type PaletteCatalogEntry,
  type PaletteEntryState,
  paletteCatalog,
  type WorkflowPaletteSnapshot,
} from "../paletteCatalog";
import {
  configurableWorkflowTrigger,
  describePaletteContext,
  type PaletteContext,
  type PaletteContextEntry,
  type PickerRequest,
  type PickerSelection,
} from "../paletteContext";
import type { WorkflowDefinition } from "../schemas";

export type PaletteRead = {
  status: "loading" | "ready" | "error" | "denied";
  workflowId?: string;
  data?: WorkflowPaletteSnapshot;
  retry: () => Promise<unknown>;
  retrying?: boolean;
};
export type PaletteViewEntry = {
  catalog: PaletteCatalogEntry;
  state: PaletteEntryState;
  context: PaletteContextEntry;
  selection: PickerSelection | null;
  canChoose: boolean;
};
export type PaletteView = {
  replacing: boolean;
  triggerPicker: boolean;
  status: PaletteRead["status"];
  entries: PaletteViewEntry[];
  context: PaletteContext;
  definition: WorkflowDefinition;
  authoringReason: WorkflowPaletteSnapshot["authoring"]["reason"] | "editor-readonly";
  retry: PaletteRead["retry"];
  retrying: boolean;
};

function selectionFor(
  entry: PaletteCatalogEntry,
  definition: WorkflowDefinition,
): PickerSelection | null {
  if (entry.selection === "unavailable") return null;
  if (entry.selection === "insert") return { kind: "insert", type: entry.type, version: 1 };
  const trigger = configurableWorkflowTrigger(definition);
  return trigger === undefined
    ? null
    : { kind: "configure", type: entry.type, version: 1, nodeId: trigger.id };
}

function authoringReason(read: PaletteRead, editable: boolean): PaletteView["authoringReason"] {
  if (read.data?.authoring.allowed === false)
    return read.data.authoring.reason ?? "workflow-edit-required";
  return editable ? null : "editor-readonly";
}

function matchingRead(read: PaletteRead): boolean {
  return (
    read.workflowId !== undefined &&
    read.data !== undefined &&
    read.workflowId === read.data.workflowId
  );
}
function viewStatus(read: PaletteRead, sameKey: boolean): PaletteRead["status"] {
  if (read.status === "denied") return "denied";
  if (!sameKey && (read.data !== undefined || read.status === "ready")) return "loading";
  return read.status;
}

export function buildPaletteView(
  definition: WorkflowDefinition,
  request: PickerRequest,
  read: PaletteRead,
  editable: boolean,
): PaletteView {
  const sameKey = matchingRead(read);
  const status = viewStatus(read, sameKey);
  const context = describePaletteContext(definition, request);
  const canAuthor = status === "ready" && editable && read.data?.authoring.allowed === true;
  const entries: PaletteViewEntry[] = [];
  if (sameKey && status !== "denied") {
    for (const catalog of paletteCatalog) {
      const state = read.data?.entries.find(
        (item) => findPaletteEntry(item.type, item.version) === catalog,
      );
      const input = context.entries.find(
        (item) => findPaletteEntry(item.type, item.version) === catalog,
      );
      if (state === undefined || input === undefined) continue;
      const selection = selectionFor(catalog, definition);
      entries.push({
        catalog,
        state,
        context: input,
        selection,
        canChoose:
          canAuthor && state.support === "supported" && input.reason === null && selection !== null,
      });
    }
  }
  return {
    replacing: request.kind === "replace",
    triggerPicker:
      request.kind === "replace" &&
      definition.nodes.some(
        (node) => node.id === request.nodeId && node.type.startsWith("trigger."),
      ),
    status,
    entries,
    context,
    definition,
    authoringReason: authoringReason(read, editable),
    retry: read.retry,
    retrying: read.retrying === true,
  };
}
