"use client";

import { z } from "zod";
import type { PickerRequest, PickerSelection } from "../paletteContext";
import type { WorkflowDefinition } from "../schemas";
import { NodePalette } from "./NodePalette";
import { buildPaletteView, type PaletteRead } from "./paletteView";
import { useWorkflowPalette } from "./useWorkflowPalette";

type Props = {
  workflowId?: string;
  definition: WorkflowDefinition;
  request: PickerRequest;
  editable: boolean;
  read?: PaletteRead;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onChoose: (selection: PickerSelection, read: PaletteRead) => void;
};
function Presentation({ read, ...props }: Props & { read: PaletteRead }) {
  const model = buildPaletteView(props.definition, props.request, read, props.editable);
  function choose(selection: PickerSelection) {
    const entry = model.entries.find((row) => row.catalog.type === selection.type);
    if (entry?.canChoose !== true) return;
    props.onChoose(selection, read);
  }
  return (
    <NodePalette
      open
      model={model}
      onChoose={choose}
      onClose={props.onClose}
      onCloseAutoFocus={props.onCloseAutoFocus}
    />
  );
}
function QueriedPalette(props: Props & { workflowId: string }) {
  const read = useWorkflowPalette(props.workflowId, true);
  return <Presentation {...props} read={read} />;
}
const uuid = z.string().uuid();
export function WorkflowPalette(props: Props) {
  if (props.read !== undefined) return <Presentation {...props} read={props.read} />;
  if (props.workflowId !== undefined && uuid.safeParse(props.workflowId).success)
    return <QueriedPalette key={props.workflowId} {...props} workflowId={props.workflowId} />;
  return (
    <Presentation
      {...props}
      read={{ status: "loading", retry: () => Promise.resolve(undefined) }}
    />
  );
}
