"use client";

import { type ReactNode, useState } from "react";
import { CatalogEditorDialog, CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { SalesWorkspace } from "../contracts";
import { useSalesDisplay } from "./display";
import type { SalesMessages } from "./messages";
import { SalesInput, SalesTextarea } from "./SalesFields";
import { type SalesDialog, type SalesEditor, type SalesIntent, validSalesIntent } from "./types";

type FulfillmentEditorTarget = Exclude<SalesEditor, { type: "saveDraft" }>;

function CommandDialog({
  intent,
  dialog,
  title,
  description,
  disabled = false,
  children,
}: {
  intent: SalesIntent;
  dialog: SalesDialog;
  title: string;
  description: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <CatalogEditorDialog
      {...dialog}
      title={title}
      description={description}
      submitDisabled={disabled || !validSalesIntent(intent)}
      submit={() => dialog.save(intent)}
    >
      {children}
    </CatalogEditorDialog>
  );
}

type EditorProps<T extends FulfillmentEditorTarget["type"]> = {
  editor: FulfillmentEditorTarget & { type: T };
  dialog: SalesDialog;
  t: SalesMessages;
};

function orderVersion(order: FulfillmentEditorTarget["order"]) {
  return { orderId: order.id, version: order.version };
}

function StockLabel(
  stock: { location: string; lot: string | null; serial: string | null },
  t: SalesMessages,
) {
  const labels = [stock.location];
  if (stock.lot !== null) labels.push(`${t.lot} ${stock.lot}`);
  if (stock.serial !== null) labels.push(`${t.serial} ${stock.serial}`);
  return labels.join(" · ");
}

function AllocateEditor({ editor, dialog, t }: EditorProps<"allocate">) {
  const { line } = editor;
  const [positionId, selectPosition] = useState("");
  const [quantity, setQuantity] = useState("1");
  const f = useSalesDisplay();
  const remaining = Math.max(0, line.quantity - line.shipped - line.allocated);
  const position = line.positions.find(({ id }) => id === positionId);
  const limit = Math.min(remaining, position?.available ?? 0);
  const count = Number(quantity);
  const intent: SalesIntent = {
    type: "allocate",
    ...orderVersion(editor.order),
    lineId: line.id,
    positionId,
    quantity: count,
  };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={t.allocate}
      description={t.allocateDescription}
      disabled={count > limit}
    >
      <p className="text-sm">
        <bdi>
          {line.code} · {line.name}
        </bdi>
      </p>
      <CatalogField label={t.pickStock}>
        <CatalogSelect
          ariaLabel={t.pickStock}
          value={positionId}
          options={line.positions.map((row) => ({
            value: row.id,
            label: `${StockLabel(row, t)} · ${f.quantity(row.available)} ${t.available}`,
          }))}
          onChange={selectPosition}
          disabled={dialog.pending || line.positions.length === 0}
        />
      </CatalogField>
      {line.positions.length === 0 && <p className="text-sm text-muted-foreground">{t.noStock}</p>}
      <SalesInput
        label={t.quantity}
        type="number"
        min={1}
        max={limit}
        step={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
        disabled={dialog.pending || limit === 0}
      />
    </CommandDialog>
  );
}

function ReleaseEditor({ editor, dialog, t }: EditorProps<"deallocate">) {
  const [quantity, change] = useState("1");
  const allocation = editor.allocation;
  const limit = allocation.quantity - allocation.committed;
  const count = Number(quantity);
  const intent: SalesIntent = {
    type: "deallocate",
    ...orderVersion(editor.order),
    allocationId: allocation.id,
    quantity: count,
  };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={t.releaseAllocation}
      description={t.releaseAllocationDescription}
      disabled={count > limit}
    >
      <p className="text-sm">
        <bdi>{StockLabel(allocation, t)}</bdi>
      </p>
      <SalesInput
        label={t.quantity}
        type="number"
        min={1}
        max={limit}
        step={1}
        value={quantity}
        onChange={(event) => change(event.target.value)}
        required
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

function PrepareEditor({ editor, dialog, t }: EditorProps<"createShipment">) {
  const [reference, setReference] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const f = useSalesDisplay();
  const picks = editor.order.lines.flatMap((line) =>
    line.allocations.flatMap((allocation) =>
      allocation.quantity > allocation.committed
        ? [{ line, allocation, free: allocation.quantity - allocation.committed }]
        : [],
    ),
  );
  const selection = picks.map(({ allocation, free }) => ({
    allocationId: allocation.id,
    free,
    quantity: Number(quantities[allocation.id] ?? 0),
  }));
  const selected = selection.filter(({ quantity }) => quantity > 0);
  const intent: SalesIntent = {
    type: "createShipment",
    ...orderVersion(editor.order),
    reference,
    lines: selected.map(({ allocationId, quantity }) => ({ allocationId, quantity })),
  };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={t.newShipment}
      description={t.newShipmentDescription}
      disabled={selection.some(
        ({ quantity, free }) => !Number.isSafeInteger(quantity) || quantity < 0 || quantity > free,
      )}
    >
      <SalesInput
        label={t.shipmentReference}
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        maxLength={80}
        required
        disabled={dialog.pending}
      />
      {picks.length === 0 && <p className="text-sm text-muted-foreground">{t.noAllocations}</p>}
      <ul className="divide-y rounded-md border bg-background empty:hidden">
        {picks.map(({ line, allocation, free }) => (
          <li
            className="grid items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_7rem]"
            key={allocation.id}
            data-sales-pick-allocation={allocation.id}
          >
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="font-medium">
                <bdi>
                  {line.code} · {line.name}
                </bdi>
              </p>
              <p className="break-words text-xs text-muted-foreground">
                <bdi>{StockLabel(allocation, t)}</bdi> · <bdi>{f.quantity(free)}</bdi> {t.available}
              </p>
            </div>
            <SalesInput
              label={t.quantity}
              type="number"
              min={0}
              max={free}
              step={1}
              value={quantities[allocation.id] ?? "0"}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [allocation.id]: event.target.value }))
              }
              disabled={dialog.pending}
            />
          </li>
        ))}
      </ul>
    </CommandDialog>
  );
}

function CheckEditor({ editor, dialog, t }: EditorProps<"checkShipmentLine">) {
  const [scan, setScan] = useState("");
  const { shipment, line } = editor;
  const checked = !line.checked;
  const code = scan.trim();
  const intent: SalesIntent = {
    type: "checkShipmentLine",
    ...orderVersion(editor.order),
    shipmentId: shipment.id,
    shipmentLineId: line.id,
    checked,
    ...(checked && code !== "" ? { scan: code } : {}),
  };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={checked ? t.check : t.undoCheck}
      description={t.checkDescription}
    >
      <p className="break-words text-sm">
        <bdi>{StockLabel(line, t)}</bdi>
      </p>
      {checked && (
        <SalesInput
          label={t.scan}
          value={scan}
          maxLength={120}
          onChange={(event) => setScan(event.target.value)}
          disabled={dialog.pending}
        />
      )}
    </CommandDialog>
  );
}

function PostEditor({ editor, today, dialog, t }: EditorProps<"postShipment"> & { today: string }) {
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [shippedOn, setShippedOn] = useState(today);
  const intent: SalesIntent = {
    type: "postShipment",
    ...orderVersion(editor.order),
    shipmentId: editor.shipment.id,
    carrier,
    tracking: tracking.trim() === "" ? null : tracking,
    shippedOn,
  };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={t.postShipment}
      description={t.postShipmentDescription}
    >
      <SalesInput
        label={t.carrier}
        value={carrier}
        onChange={(event) => setCarrier(event.target.value)}
        maxLength={120}
        required
        disabled={dialog.pending}
      />
      <SalesInput
        label={t.tracking}
        value={tracking}
        onChange={(event) => setTracking(event.target.value)}
        maxLength={160}
        disabled={dialog.pending}
      />
      <SalesInput
        label={t.shipDate}
        type="date"
        value={shippedOn}
        max={today}
        onChange={(event) => setShippedOn(event.target.value)}
        required
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

function DueDateEditor({ editor, dialog, t }: EditorProps<"reschedule">) {
  const [dueDate, change] = useState(editor.order.dueDate ?? "");
  return (
    <CommandDialog
      dialog={dialog}
      title={t.reschedule}
      description={t.rescheduleDescription}
      intent={{
        type: "reschedule",
        ...orderVersion(editor.order),
        dueDate: dueDate === "" ? null : dueDate,
      }}
    >
      <SalesInput
        label={t.due}
        type="date"
        value={dueDate}
        onChange={(event) => change(event.target.value)}
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

function CancelOrderEditor({ editor, dialog, t }: EditorProps<"cancelOrder">) {
  const [reason, change] = useState("");
  return (
    <CommandDialog
      dialog={dialog}
      title={t.cancelOrder}
      description={t.cancelOrderDescription}
      intent={{ type: "cancelOrder", ...orderVersion(editor.order), reason }}
    >
      <SalesTextarea
        label={t.reason}
        value={reason}
        onChange={(event) => change(event.target.value)}
        maxLength={400}
        required
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

export function FulfillmentEditor({
  editor,
  workspace,
  dialog,
  t,
}: {
  editor: FulfillmentEditorTarget;
  workspace: SalesWorkspace;
  dialog: SalesDialog;
  t: SalesMessages;
}) {
  switch (editor.type) {
    case "allocate":
      return <AllocateEditor {...{ editor, dialog, t }} />;
    case "deallocate":
      return <ReleaseEditor {...{ editor, dialog, t }} />;
    case "createShipment":
      return <PrepareEditor {...{ editor, dialog, t }} />;
    case "checkShipmentLine":
      return <CheckEditor {...{ editor, dialog, t }} />;
    case "postShipment":
      return <PostEditor {...{ editor, dialog, t }} today={workspace.today} />;
    case "reschedule":
      return <DueDateEditor {...{ editor, dialog, t }} />;
    case "cancelOrder":
      return <CancelOrderEditor {...{ editor, dialog, t }} />;
    case "issueOrder":
      return (
        <CommandDialog
          dialog={dialog}
          title={t.issue}
          description={t.issueDescription}
          intent={{ type: "issueOrder", ...orderVersion(editor.order) }}
        />
      );
    case "autoAllocate":
      return (
        <CommandDialog
          dialog={dialog}
          title={t.autoAllocate}
          description={t.autoAllocationDescription}
          intent={{ type: "autoAllocate", ...orderVersion(editor.order) }}
        />
      );
    case "cancelShipment":
      return (
        <CommandDialog
          dialog={dialog}
          title={t.cancelShipment}
          description={t.cancelShipmentDescription}
          intent={{
            type: "cancelShipment",
            ...orderVersion(editor.order),
            shipmentId: editor.shipment.id,
          }}
        />
      );
  }
}
