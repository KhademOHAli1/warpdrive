"use client";

import { useId, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import {
  CatalogCheckbox,
  CatalogEditorDialog,
  CatalogField,
  CatalogSelect,
} from "../../catalog/ui/CatalogFields";
import type { ProductionIntent } from "../../production/contracts";
import type { ProductionMessages } from "../../production/ui/messages";
import {
  ProductionQuantityField,
  ProductionReasonField,
  parsedQuantity,
  useProductionNumber,
} from "../../production/ui/ProductionFields";
import { PositionLabel } from "../../production/ui/ProductionMaterials";
import type { ProductionDialog } from "../../production/ui/types";
import { type SubcontractMessages, subcontractMessages } from "./messages";
import { availableDispatches, custodyRemaining, type SubcontractEditor } from "./types";

type EditorProps = { editor: SubcontractEditor; dialog: ProductionDialog; t: ProductionMessages };
type FieldsProps = Omit<EditorProps, "editor"> & { labels: SubcontractMessages };

function LinkEditor({
  editor,
  dialog,
  labels,
}: FieldsProps & { editor: Extract<SubcontractEditor, { type: "linkSubcontract" }> }) {
  const checkboxId = useId();
  const number = useProductionNumber();
  const { options, build } = editor;
  const [lineId, setLineId] = useState("");
  const [binId, setBinId] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const line = options.lines.find(({ id }) => id === lineId);
  const bin = options.bins.find(({ id }) => id === binId);
  const materials = build.materials.filter(({ consumable }) => !consumable);
  return (
    <CatalogEditorDialog
      {...dialog}
      title={labels.linkSubcontract}
      description={labels.linkDescription}
      submitDisabled={dialog.blocked || line === undefined || bin === undefined}
      submit={() => {
        if (line === undefined || bin === undefined) return;
        dialog.save({
          type: editor.type,
          buildId: build.id,
          version: build.version,
          orderId: line.orderId,
          lineId: line.id,
          supplierBinId: bin.id,
          companyMaterialIds: companies,
        });
      }}
    >
      <CatalogField label={labels.purchaseLine}>
        <CatalogSelect
          ariaLabel={labels.purchaseLine}
          placeholder={labels.choosePurchaseLine}
          options={options.lines.map(({ id, reference, supplier, quantity }) => ({
            value: id,
            label: `${reference} · ${supplier} · ${number(quantity)}`,
          }))}
          value={lineId}
          onChange={setLineId}
          disabled={dialog.pending}
        />
      </CatalogField>
      <CatalogField label={labels.supplierLocation}>
        <CatalogSelect
          ariaLabel={labels.supplierLocation}
          placeholder={labels.chooseSupplierLocation}
          options={options.bins.map(({ id, code, name }) => ({
            value: id,
            label: `${code} · ${name}`,
          }))}
          value={binId}
          onChange={setBinId}
          disabled={dialog.pending}
        />
      </CatalogField>
      {materials.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{labels.companyMaterials}</legend>
          <p className="text-sm text-muted-foreground">{labels.companyMaterialsHint}</p>
          <div className="flex flex-col gap-1">
            {materials.map(({ id, part }) => (
              <CatalogCheckbox
                key={id}
                id={`${checkboxId}-${id}`}
                label={`${part.code} · ${part.name}`}
                checked={companies.includes(id)}
                disabled={dialog.pending}
                change={(checked) =>
                  setCompanies((prior) =>
                    checked ? [...prior, id] : prior.filter((entry) => entry !== id),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      )}
    </CatalogEditorDialog>
  );
}

const dispatchLimit = 600;

function checkedReason(reason: string) {
  const value = reason.trim();
  return value.length > 0 && !value.includes("\0") ? value : null;
}

function DispatchEditor({
  editor,
  dialog,
  t,
  labels,
}: FieldsProps & { editor: Extract<SubcontractEditor, { type: "dispatchSubcontract" }> }) {
  const number = useProductionNumber();
  const dispatches = availableDispatches(editor.build, editor.link);
  const [quantities, setQuantities] = useState(
    () =>
      new Map(
        dispatches.slice(0, dispatchLimit).map(({ key, quantity }) => [key, String(quantity)]),
      ),
  );
  const [reason, setReason] = useState("");
  const submitted = dispatches.flatMap(({ key, quantity, materialId, position }) => {
    const input = quantities.get(key)?.trim() ?? "";
    return input === ""
      ? []
      : [{ materialId, positionId: position.id, quantity: parsedQuantity(input, quantity) }];
  });
  const allocations = submitted.flatMap((row) =>
    row.quantity === null ? [] : [{ ...row, quantity: row.quantity }],
  );
  const valid =
    allocations.length > 0 &&
    allocations.length <= dispatchLimit &&
    allocations.length === submitted.length;
  const reasonValue = checkedReason(reason);
  return (
    <CatalogEditorDialog
      {...dialog}
      title={labels.dispatchSubcontract}
      description={labels.dispatchDescription}
      submitDisabled={dialog.blocked || !valid || reasonValue === null}
      submit={() => {
        if (!valid || reasonValue === null) return;
        dialog.save({
          type: editor.type,
          buildId: editor.build.id,
          version: editor.build.version,
          reason: reasonValue,
          allocations,
        });
      }}
    >
      <p className="text-sm text-muted-foreground">{labels.dispatchQuantityHint}</p>
      <ul className="divide-y rounded-md border">
        {dispatches.map(({ key, position, part, quantity }) => (
          <li
            key={key}
            className="grid min-w-0 items-start gap-2 p-2.5 sm:grid-cols-[minmax(0,1fr)_8rem]"
            data-subcontract-allocation-position={position.id}
          >
            <div className="space-y-1 text-sm">
              <p className="break-words font-medium">
                <bdi>
                  {part.code} · {part.name}
                </bdi>
              </p>
              <div className="text-xs text-muted-foreground">
                <PositionLabel {...{ position, t }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t.allocated}{" "}
                <bdi>
                  {number(quantity)} {part.unit}
                </bdi>
              </p>
            </div>
            <ProductionQuantityField
              label={t.allocationQuantity}
              value={quantities.get(key) ?? ""}
              change={(value) => setQuantities((prior) => new Map(prior).set(key, value))}
              disabled={dialog.pending}
              required={false}
            />
          </li>
        ))}
      </ul>
      <ProductionReasonField
        label={t.reason}
        {...{ reason }}
        change={setReason}
        pending={dialog.pending}
      />
    </CatalogEditorDialog>
  );
}

function CustodyEditor({
  editor,
  dialog,
  t,
  labels,
}: FieldsProps & {
  editor: Extract<
    SubcontractEditor,
    { type: "returnSubcontractMaterial" | "releaseSubcontractOutput" }
  >;
}) {
  const returning = editor.type === "returnSubcontractMaterial";
  const available = returning ? custodyRemaining(editor.dispatch) : 0;
  const [quantity, setQuantity] = useState(String(available));
  const [reason, setReason] = useState("");
  const number = useProductionNumber();
  const count = parsedQuantity(quantity, available);
  const reasonValue = checkedReason(reason);
  const base = { buildId: editor.build.id, version: editor.build.version };
  function currentIntent(): ProductionIntent | null {
    if (reasonValue === null) return null;
    if (!returning)
      return { ...base, type: editor.type, outputId: editor.output.id, reason: reasonValue };
    return count === null
      ? null
      : {
          ...base,
          type: editor.type,
          dispatchId: editor.dispatch.id,
          quantity: count,
          reason: reasonValue,
        };
  }
  const intent = currentIntent();
  return (
    <CatalogEditorDialog
      {...dialog}
      title={labels[editor.type]}
      description={returning ? labels.returnDescription : labels.releaseDescription}
      submitDisabled={dialog.blocked || intent === null}
      submit={() => {
        if (intent !== null) dialog.save(intent);
      }}
    >
      {returning ? (
        <>
          <p className="text-sm text-muted-foreground">
            {labels.inCustody} <bdi>{number(available)}</bdi>
          </p>
          <ProductionQuantityField
            label={t.allocationQuantity}
            value={quantity}
            change={setQuantity}
            disabled={dialog.pending}
          />
        </>
      ) : (
        <p className="text-sm">
          {t.outputBatch} <bdi>{editor.output.lot ?? editor.output.id.slice(0, 8)}</bdi> ·{" "}
          <bdi>{number(editor.output.quantity)}</bdi>
        </p>
      )}
      <ProductionReasonField
        label={t.reason}
        {...{ reason }}
        change={setReason}
        pending={dialog.pending}
      />
    </CatalogEditorDialog>
  );
}

export function SubcontractEditors({ editor, dialog, t }: EditorProps) {
  const labels = subcontractMessages[useLocale()];
  switch (editor.type) {
    case "linkSubcontract":
      return <LinkEditor {...{ editor, dialog, t, labels }} />;
    case "dispatchSubcontract":
      return <DispatchEditor {...{ editor, dialog, t, labels }} />;
    case "returnSubcontractMaterial":
    case "releaseSubcontractOutput":
      return <CustodyEditor {...{ editor, dialog, t, labels }} />;
  }
}
