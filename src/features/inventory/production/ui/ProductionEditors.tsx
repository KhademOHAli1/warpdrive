"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { CatalogEditorDialog, CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { ProductionWorkspace } from "../contracts";
import type { ProductionMessages } from "./messages";
import {
  type BuildSchedule,
  ProductionQuantityField,
  ProductionReasonField,
  ProductionScheduleFields,
  parsedQuantity,
  useProductionNumber,
} from "./ProductionFields";
import { ProductionPlanEditor } from "./ProductionPlanEditor";
import {
  batchRemaining,
  materialRemaining,
  type ProductionDialog,
  type ProductionEditor,
} from "./types";

type DirectEditor = Extract<
  ProductionEditor,
  { type: "schedule" | "issue" | "hold" | "resume" | "autoAllocate" | "startBatch" | "cancelBuild" }
>;
type AllocationEditorType = Extract<ProductionEditor, { type: "allocate" | "deallocate" }>;
type BatchEditorType = Extract<
  ProductionEditor,
  { type: "completeBatch" | "scrapBatch" | "cancelBatch" | "reverseOutput" }
>;

function hasReason(value: string) {
  return value.trim() !== "" && !value.includes("\0");
}

function DirectBuildEditor({
  editor,
  dialog,
  t,
}: {
  editor: DirectEditor;
  dialog: ProductionDialog;
  t: ProductionMessages;
}) {
  const { type, build } = editor;
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [schedule, setSchedule] = useState<BuildSchedule>({
    priority: build.priority,
    dueDate: build.dueDate ?? "",
  });
  const maximumBatch = build.trackable ? 500 : 1_000_000;
  const count = parsedQuantity(quantity, Math.min(maximumBatch, batchRemaining(build)));
  const needsReason = type === "hold" || type === "resume" || type === "cancelBuild";
  return (
    <CatalogEditorDialog
      {...dialog}
      title={t[type]}
      description={t[`${type}Description`]}
      submitDisabled={
        dialog.blocked ||
        (needsReason && !hasReason(reason)) ||
        (type === "startBatch" && count === null)
      }
      submit={() => {
        const base = { buildId: build.id, version: build.version };
        switch (type) {
          case "schedule":
            dialog.save({
              ...base,
              type,
              priority: schedule.priority,
              dueDate: schedule.dueDate || null,
            });
            return;
          case "hold":
          case "resume":
          case "cancelBuild":
            dialog.save({ ...base, type, reason: reason.trim() });
            return;
          case "startBatch":
            if (count !== null) dialog.save({ ...base, type, quantity: count });
            return;
          case "issue":
          case "autoAllocate":
            dialog.save({ ...base, type });
        }
      }}
    >
      {type === "schedule" && (
        <ProductionScheduleFields
          t={t}
          value={schedule}
          change={setSchedule}
          pending={dialog.pending}
        />
      )}
      {type === "startBatch" && (
        <ProductionQuantityField
          label={t.allocationQuantity}
          value={quantity}
          change={setQuantity}
          disabled={dialog.pending}
        />
      )}
      {needsReason && (
        <ProductionReasonField
          label={t.reason}
          reason={reason}
          change={setReason}
          pending={dialog.pending}
        />
      )}
    </CatalogEditorDialog>
  );
}

function AllocationEditor({
  editor,
  dialog,
  t,
}: {
  editor: AllocationEditorType;
  dialog: ProductionDialog;
  t: ProductionMessages;
}) {
  const number = useProductionNumber();
  const { material, build } = editor;
  const releasing = editor.type === "deallocate";
  const [positionId, setPositionId] = useState(
    releasing ? editor.position.id : (material.positions.find(({ free }) => free > 0)?.id ?? ""),
  );
  const [quantity, setQuantity] = useState(releasing ? String(editor.quantity) : "1");
  const stock = material.positions.find(({ id }) => id === positionId);
  const maximum = releasing
    ? editor.quantity
    : Math.min(stock?.free ?? 0, materialRemaining(material));
  const count = parsedQuantity(quantity, Math.min(maximum, 1_000_000));
  const title = releasing ? t.releaseStock : t.allocate;
  return (
    <CatalogEditorDialog
      {...dialog}
      title={title}
      description={releasing ? t.releaseStockDescription : t.allocateDescription}
      submitDisabled={dialog.blocked || count === null || positionId === ""}
      submit={() => {
        if (count === null || positionId === "") return;
        dialog.save({
          type: editor.type,
          buildId: build.id,
          version: build.version,
          materialId: material.id,
          positionId,
          quantity: count,
        });
      }}
    >
      <p className="text-sm">
        <bdi>
          {material.part.code} · {material.part.name}
        </bdi>
      </p>
      {!releasing && (
        <CatalogField label={t.position}>
          <CatalogSelect
            ariaLabel={t.position}
            value={positionId}
            options={material.positions
              .filter(({ free }) => free > 0)
              .map(({ id, location, lot, serial, free }) => ({
                value: id,
                label: [location, lot, serial, number(free)]
                  .filter((candidate) => candidate !== null)
                  .join(" · "),
              }))}
            onChange={setPositionId}
            disabled={dialog.pending}
          />
        </CatalogField>
      )}
      <ProductionQuantityField
        label={t.allocationQuantity}
        value={quantity}
        change={setQuantity}
        disabled={dialog.pending}
      />
      <p className="text-sm text-muted-foreground">
        {releasing ? t.allocated : t.available}{" "}
        <bdi>
          {number(maximum)} {material.part.unit}
        </bdi>
      </p>
    </CatalogEditorDialog>
  );
}

function OutputEditor({
  editor,
  dialog,
  t,
}: {
  editor: BatchEditorType;
  dialog: ProductionDialog;
  t: ProductionMessages;
}) {
  const lotId = useId();
  const serialsId = useId();
  const number = useProductionNumber();
  const { type, build, output } = editor;
  const [lot, setLot] = useState("");
  const [enteredSerials, setEnteredSerials] = useState("");
  const [reason, setReason] = useState("");
  const complete = type === "completeBatch";
  const captureSerials = complete && output.quantity <= 500;
  const serials = captureSerials
    ? enteredSerials
        .split(/\r?\n/u)
        .map((entry) => entry.trim().toUpperCase())
        .filter((entry) => entry !== "")
    : [];
  const serialsValid =
    (!build.trackable && serials.length === 0) ||
    (serials.length === output.quantity &&
      new Set(serials).size === serials.length &&
      serials.every((serial) => serial.length <= 80 && !serial.includes("\0")));
  const lotValid = lot.trim() !== "" && lot.trim().length <= 80 && !lot.includes("\0");
  return (
    <CatalogEditorDialog
      {...dialog}
      title={t[type]}
      description={t[`${type}Description`]}
      submitDisabled={
        dialog.blocked || !hasReason(reason) || (complete && (!lotValid || !serialsValid))
      }
      submit={() => {
        const base = {
          buildId: build.id,
          version: build.version,
          outputId: output.id,
          reason: reason.trim(),
        };
        if (type === "cancelBatch" || type === "reverseOutput") {
          dialog.save({ ...base, type });
        } else {
          dialog.save({
            ...base,
            type: "finalizeBatch",
            disposition: complete ? "completed" : "scrapped",
            lot: complete ? lot.trim() : null,
            serials,
          });
        }
      }}
    >
      <p className="text-sm">
        {t.allocationQuantity} <bdi>{number(output.quantity)}</bdi>
      </p>
      {complete && (
        <CatalogField id={lotId} label={t.lot}>
          <Input
            id={lotId}
            value={lot}
            onChange={(event) => setLot(event.target.value)}
            maxLength={80}
            disabled={dialog.pending}
            required
          />
        </CatalogField>
      )}
      {captureSerials && (
        <CatalogField id={serialsId} label={t.serials}>
          <Textarea
            id={serialsId}
            required={build.trackable}
            value={enteredSerials}
            placeholder={t.serialHint}
            rows={Math.min(output.quantity, 8)}
            maxLength={40_500}
            disabled={dialog.pending}
            onChange={(event) => setEnteredSerials(event.target.value)}
          />
        </CatalogField>
      )}
      <ProductionReasonField
        label={t.reason}
        reason={reason}
        change={setReason}
        pending={dialog.pending}
      />
    </CatalogEditorDialog>
  );
}

export function ProductionEditors({
  editor,
  workspace,
  initialSiteId,
  initialReleaseId,
  dialog,
  t,
}: {
  editor: ProductionEditor;
  workspace: ProductionWorkspace;
  initialSiteId?: string;
  initialReleaseId?: string;
  dialog: ProductionDialog;
  t: ProductionMessages;
}) {
  switch (editor.type) {
    case "createBuild":
      return (
        <ProductionPlanEditor {...{ workspace, initialSiteId, initialReleaseId, dialog, t }} />
      );
    case "allocate":
    case "deallocate":
      return <AllocationEditor {...{ editor, dialog, t }} />;
    case "completeBatch":
    case "scrapBatch":
    case "cancelBatch":
    case "reverseOutput":
      return <OutputEditor {...{ editor, dialog, t }} />;
    case "schedule":
    case "issue":
    case "hold":
    case "resume":
    case "autoAllocate":
    case "startBatch":
    case "cancelBuild":
      return <DirectBuildEditor {...{ editor, dialog, t }} />;
  }
}
