"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import {
  CatalogEditorDialog as EditorDialog,
  CatalogField as Field,
  CatalogSelect as FieldSelect,
} from "../../catalog/ui/CatalogFields";
import type {
  WarehouseIncoming,
  WarehouseLocationKind,
  WarehousePosition,
  WarehouseStockState,
  WarehouseWorkspace,
} from "../contracts";
import {
  locationKinds,
  locationOptions,
  managedLocations,
  receivableLocations,
  stockStates,
  type WarehouseDialogProps,
  warehousePartLabel,
} from "./warehouseDisplay";
import { type WarehouseWords, warehouseMessages } from "./warehouseMessages";

const maxMovement = 1_000_000;

export function WarehouseIntakeDialog({
  workspace,
  initialLocationId,
  initialPartId,
  mode,
  incoming,
  ...dialog
}: WarehouseDialogProps & {
  workspace: WarehouseWorkspace;
  initialLocationId?: string;
  initialPartId?: string;
  mode: "receive" | "reconcile" | "createIncoming";
  incoming: WarehouseIncoming | null;
}) {
  const t = warehouseMessages[useLocale()];
  const inputId = useId();
  const isReconcile = mode === "reconcile";
  const isPlan = mode === "createIncoming";
  const locations = receivableLocations(workspace);
  const parts = workspace.parts.filter(
    (part) => part.canReceive && (!isReconcile || unlocatedAvailable(workspace, part.id) > 0),
  );
  const [partId, setPartId] = useState(
    incoming?.itemId ?? (parts.some(({ id }) => id === initialPartId) ? initialPartId : "") ?? "",
  );
  const [locationId, setLocationId] = useState(
    incoming?.locationId ??
      (locations.some(({ id }) => id === initialLocationId) ? initialLocationId : "") ??
      "",
  );
  const [quantity, setQuantity] = useState("1");
  const [lot, setLot] = useState("");
  const [serial, setSerial] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [state, setState] = useState<WarehouseStockState>("available");
  const [ownerId, setOwnerId] = useState(incoming?.ownerOrganizationId ?? "");
  const part = parts.find(({ id }) => id === partId);
  const serialized = !isPlan && (part?.trackable === true || serial.trim() !== "");
  const plannedRemaining = incoming === null ? maxMovement : incoming.quantity - incoming.received;
  const upTo = isReconcile
    ? Math.min(maxMovement, unlocatedAvailable(workspace, partId))
    : plannedRemaining;
  const labels = {
    receive: { title: incoming === null ? t.receive : t.receivePlan, hint: t.receiveDescription },
    reconcile: { title: t.reconcile, hint: t.reconcileDescription },
    createIncoming: { title: t.recordIncoming, hint: t.incomingDescription },
  };
  const amount = serialized ? 1 : Number(quantity);
  const canSubmit =
    partId !== "" &&
    locationId !== "" &&
    amount > 0 &&
    amount <= upTo &&
    (!serialized || serial.trim() !== "");

  function save() {
    if (!canSubmit) return;
    const base = {
      itemId: partId,
      locationId,
      quantity: amount,
      ownerOrganizationId: ownerId || null,
    };
    if (isPlan) {
      void dialog.save({
        type: "createIncoming",
        ...base,
        expectedDate: date || null,
        reference: reference.trim() || null,
      });
      return;
    }
    const position = {
      ...base,
      state,
      lot: lot.trim() || null,
      serial: serial.trim() || null,
      expiryDate: date || null,
    };
    void dialog.save(
      mode === "reconcile"
        ? { type: "reconcile", ...position }
        : { type: "receive", ...position, incomingId: incoming?.id ?? null },
    );
  }

  return (
    <EditorDialog
      {...dialog}
      title={labels[mode].title}
      description={labels[mode].hint}
      submit={save}
      submitDisabled={!canSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.part}>
          <FieldSelect
            ariaLabel={t.part}
            placeholder={t.pickPart}
            value={partId}
            disabled={dialog.pending || incoming !== null}
            options={parts.map((item) => ({ value: item.id, label: warehousePartLabel(item) }))}
            onChange={(id) => {
              setPartId(id);
              setQuantity("1");
            }}
          />
        </Field>
        <Field label={t.location}>
          <FieldSelect
            ariaLabel={t.location}
            placeholder={t.pickLocation}
            value={locationId}
            disabled={dialog.pending || incoming !== null}
            options={locationOptions(locations, workspace)}
            onChange={setLocationId}
          />
        </Field>
        <Field id={`${inputId}-quantity`} label={t.quantity}>
          <Input
            id={`${inputId}-quantity`}
            type="number"
            min={1}
            max={Math.max(1, upTo)}
            required
            step={1}
            readOnly={serialized}
            disabled={dialog.pending}
            value={serialized ? "1" : quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {serialized && <p className="text-xs text-muted-foreground">{t.quantityOne}</p>}
        </Field>
        <Field label={t.owner}>
          <FieldSelect
            ariaLabel={t.owner}
            value={ownerId}
            disabled={dialog.pending || incoming !== null || workspace.organizations.length === 0}
            options={[
              { value: "", label: t.warehouseOwned },
              ...workspace.organizations.map(({ id, name }) => ({ value: id, label: name })),
            ]}
            onChange={setOwnerId}
          />
        </Field>
        {isPlan ? (
          <Field id={`${inputId}-reference`} label={t.reference}>
            <Input
              id={`${inputId}-reference`}
              maxLength={120}
              disabled={dialog.pending}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
        ) : (
          <PositionIdentity
            t={t}
            id={inputId}
            pending={dialog.pending}
            lot={lot}
            serial={serial}
            state={state}
            serialized={serialized}
            setLot={setLot}
            setSerial={setSerial}
            setState={setState}
          />
        )}
        <Field id={`${inputId}-date`} label={isPlan ? t.expectedDate : t.expiryDate}>
          <Input
            id={`${inputId}-date`}
            type="date"
            disabled={dialog.pending}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      </div>
    </EditorDialog>
  );
}

function unlocatedAvailable(workspace: WarehouseWorkspace, itemId: string) {
  const balance = workspace.balances.find(
    (entry) => entry.siteId === null && entry.itemId === itemId,
  );
  return balance === undefined ? 0 : balance.onHand - balance.reserved;
}

function PositionIdentity({
  t,
  id,
  pending,
  lot,
  serial,
  state,
  serialized,
  setLot,
  setSerial,
  setState,
}: {
  t: WarehouseWords;
  id: string;
  pending: boolean;
  lot: string;
  serial: string;
  state: WarehouseStockState;
  serialized: boolean;
  setLot: (value: string) => void;
  setSerial: (value: string) => void;
  setState: (value: WarehouseStockState) => void;
}) {
  return (
    <>
      <Field id={`${id}-lot`} label={t.lot}>
        <Input
          id={`${id}-lot`}
          dir="ltr"
          maxLength={80}
          disabled={pending}
          value={lot}
          onChange={(event) => setLot(event.target.value)}
        />
      </Field>
      <Field id={`${id}-serial`} label={t.serial}>
        <Input
          id={`${id}-serial`}
          dir="ltr"
          maxLength={80}
          required={serialized}
          disabled={pending}
          value={serial}
          onChange={(event) => setSerial(event.target.value)}
        />
      </Field>
      <Field label={t.state}>
        <FieldSelect
          ariaLabel={t.state}
          value={state}
          disabled={pending}
          options={stockStates.map((value) => ({ value, label: t[value] }))}
          onChange={(value) => setState(value as WarehouseStockState)}
        />
      </Field>
    </>
  );
}

export function WarehouseStateDialog({
  position,
  ...dialog
}: WarehouseDialogProps & { position: WarehousePosition }) {
  const t = warehouseMessages[useLocale()];
  const id = useId();
  const [state, setState] = useState(position.state);
  const remaining = Math.min(maxMovement, position.onHand - position.reserved);
  const [quantity, setQuantity] = useState(String(remaining));
  const amount = Number(quantity);
  return (
    <EditorDialog
      {...dialog}
      title={t.changeState}
      description={t.stateDescription}
      submitDisabled={state === position.state || amount < 1 || amount > remaining}
      submit={() =>
        void dialog.save({ type: "setPositionState", id: position.id, state, quantity: amount })
      }
    >
      <Field label={t.state}>
        <FieldSelect
          ariaLabel={t.state}
          value={state}
          disabled={dialog.pending}
          options={stockStates.map((value) => ({ value, label: t[value] }))}
          onChange={(value) => setState(value as WarehouseStockState)}
        />
      </Field>
      <Field id={id} label={t.quantity}>
        <Input
          id={id}
          required
          type="number"
          min={1}
          max={remaining}
          step={1}
          disabled={dialog.pending}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
    </EditorDialog>
  );
}

export function WarehousePolicyDialog({
  workspace,
  initialLocationId,
  ...dialog
}: WarehouseDialogProps & { workspace: WarehouseWorkspace; initialLocationId?: string }) {
  const t = warehouseMessages[useLocale()];
  const choices = managedLocations(workspace);
  const initial = choices.find(({ id }) => id === initialLocationId);
  const [locationId, setLocationId] = useState(initial?.id ?? "");
  const [kind, setKind] = useState<WarehouseLocationKind>(initial?.kind ?? "storage");
  return (
    <EditorDialog
      {...dialog}
      title={t.policy}
      description={t.policyDescription}
      submitDisabled={locationId === ""}
      submit={() => void dialog.save({ type: "saveLocationPolicy", locationId, kind })}
    >
      <Field label={t.location}>
        <FieldSelect
          ariaLabel={t.location}
          placeholder={t.pickLocation}
          value={locationId}
          disabled={dialog.pending}
          options={locationOptions(choices, workspace)}
          onChange={(id) => {
            setLocationId(id);
            setKind(choices.find((entry) => entry.id === id)?.kind ?? "storage");
          }}
        />
      </Field>
      <Field label={t.policyKind}>
        <FieldSelect
          ariaLabel={t.policyKind}
          value={kind}
          disabled={dialog.pending}
          options={locationKinds.map((value) => ({ value, label: t[value] }))}
          onChange={(value) => setKind(value as WarehouseLocationKind)}
        />
      </Field>
    </EditorDialog>
  );
}
