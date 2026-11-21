"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import {
  CatalogEditorDialog,
  CatalogField as Field,
  CatalogSelect as Select,
} from "../../../catalog/ui/CatalogFields";
import type { WarehouseLocation, WarehousePosition, WarehouseWorkspace } from "../../contracts";
import { locationOptions } from "../../ui/warehouseDisplay";
import { displayStockPosition } from "./display";
import { type OperationsDialogProps, ReasonField, useDialogWords } from "./OperationsDialogs";
import {
  freeStockLimit,
  installableComponent,
  installationLabel,
  mergeSources,
  mergeTargets,
  type StockStructureEditor,
  splitLimit,
  structurePositionOptions,
} from "./structureDisplay";

type PositionEditor = Extract<
  StockStructureEditor,
  { type: "splitStock" | "mergeStock" | "installComponent" }
>;
type RecoveryEditor = Extract<
  StockStructureEditor,
  { type: "removeComponent" | "disassembleStock" }
>;

export function StockStructurePositionDialog({
  editor,
  workspace,
  positions,
  ...dialog
}: OperationsDialogProps & {
  editor: PositionEditor;
  workspace: WarehouseWorkspace;
  positions: WarehousePosition[];
}) {
  const { t, numbers } = useDialogWords();
  const quantityId = useId();
  const [reason, setReason] = useState("");
  const [positionId, setPositionId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const choices =
    editor.type === "mergeStock"
      ? mergeSources(positions)
      : positions.filter((position) =>
          editor.type === "installComponent"
            ? installableComponent(editor.assembly, position)
            : splitLimit(position) > 0,
        );
  const position = choices.find(({ id }) => id === positionId);
  const targets =
    editor.type === "mergeStock" && position !== undefined ? mergeTargets(positions, position) : [];
  const maximum =
    position === undefined
      ? 0
      : editor.type === "splitStock"
        ? splitLimit(position)
        : freeStockLimit(position);
  const units = Number(quantity);
  const description = {
    splitStock: t.splitDescription,
    mergeStock: t.mergeDescription,
    installComponent: t.installDescription,
  }[editor.type];
  const sourceLabel = editor.type === "installComponent" ? t.componentPosition : t.stockPosition;
  const canSubmit =
    position !== undefined &&
    Number.isSafeInteger(units) &&
    units >= 1 &&
    units <= maximum &&
    reason.trim() !== "" &&
    (editor.type !== "mergeStock" || targets.some(({ id }) => id === destinationId));

  function submit() {
    if (position === undefined || !canSubmit) return;
    const movement = { locationId: position.locationId, quantity: units, reason: reason.trim() };
    if (editor.type === "installComponent") {
      void dialog.save({
        type: editor.type,
        assemblyPositionId: editor.assembly.id,
        componentPositionId: position.id,
        ...movement,
      });
    } else if (editor.type === "mergeStock") {
      void dialog.save({
        type: editor.type,
        sourcePositionId: position.id,
        destinationPositionId: destinationId,
        ...movement,
      });
    } else {
      void dialog.save({ type: editor.type, sourcePositionId: position.id, ...movement });
    }
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={t[editor.type]}
      description={description}
      submitDisabled={!canSubmit}
      submit={submit}
    >
      {editor.type === "installComponent" && (
        <Field label={t.assemblyPosition}>
          <bdi className="text-sm">
            {displayStockPosition(editor.assembly, workspace, t, numbers)}
          </bdi>
        </Field>
      )}
      <Field label={sourceLabel}>
        <Select
          ariaLabel={sourceLabel}
          value={position?.id ?? ""}
          options={structurePositionOptions(choices, workspace, t, numbers)}
          disabled={dialog.pending || choices.length === 0}
          onChange={(value) => {
            setPositionId(value);
            setDestinationId("");
            setQuantity("1");
          }}
        />
      </Field>
      {editor.type === "mergeStock" && (
        <Field label={t.destinationPosition}>
          <Select
            ariaLabel={t.destinationPosition}
            value={targets.some(({ id }) => id === destinationId) ? destinationId : ""}
            options={structurePositionOptions(targets, workspace, t, numbers)}
            disabled={dialog.pending || targets.length === 0}
            onChange={setDestinationId}
          />
        </Field>
      )}
      <Field id={quantityId} label={t.quantity}>
        <Input
          id={quantityId}
          className="w-32"
          type="number"
          min={1}
          max={Math.max(1, maximum)}
          step={1}
          value={quantity}
          required
          disabled={dialog.pending || position === undefined}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <ReasonField value={reason} change={setReason} pending={dialog.pending} />
    </CatalogEditorDialog>
  );
}

export function StockStructureRecoveryDialog({
  editor,
  workspace,
  locations,
  ...dialog
}: OperationsDialogProps & {
  editor: RecoveryEditor;
  workspace: WarehouseWorkspace;
  locations: WarehouseLocation[];
}) {
  const { t, numbers } = useDialogWords();
  const { assembly } = editor;
  const destinations = locations.filter(
    ({ siteId, kind }) => siteId === assembly.siteId && kind === "storage",
  );
  const [destination, setDestination] = useState(assembly.locationId);
  const [reason, setReason] = useState("");
  const canSubmit = destinations.some(({ id }) => id === destination) && reason.trim() !== "";
  const removal = editor.type === "removeComponent";

  function submit() {
    if (!canSubmit) return;
    const move = {
      assemblyLocationId: assembly.locationId,
      destinationLocationId: destination,
      reason: reason.trim(),
    };
    if (editor.type === "removeComponent") {
      void dialog.save({ type: editor.type, installationId: editor.installation.id, ...move });
    } else {
      void dialog.save({ type: editor.type, assemblyPositionId: assembly.id, ...move });
    }
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={t[editor.type]}
      description={removal ? t.removeDescription : t.disassembleDescription}
      submitDisabled={!canSubmit}
      submit={submit}
    >
      <Field label={t.assemblyPosition}>
        <bdi className="text-sm">{displayStockPosition(assembly, workspace, t, numbers)}</bdi>
      </Field>
      {removal && (
        <Field label={t.installedComponent}>
          <p className="break-words text-sm">
            <bdi>{installationLabel(editor.installation)}</bdi>
            {" · "}
            {numbers.format(editor.installation.quantity)}
            {editor.installation.lot !== null && (
              <>
                {" "}
                · {t.lot} <bdi>{editor.installation.lot}</bdi>
              </>
            )}
            {editor.installation.serial !== null && (
              <>
                {" "}
                · {t.serial} <bdi>{editor.installation.serial}</bdi>
              </>
            )}
          </p>
        </Field>
      )}
      <Field label={t.recoveryLocation}>
        <Select
          ariaLabel={t.recoveryLocation}
          value={destinations.some(({ id }) => id === destination) ? destination : ""}
          options={locationOptions(destinations, workspace)}
          disabled={dialog.pending || destinations.length === 0}
          onChange={setDestination}
        />
      </Field>
      <ReasonField value={reason} change={setReason} pending={dialog.pending} />
    </CatalogEditorDialog>
  );
}
