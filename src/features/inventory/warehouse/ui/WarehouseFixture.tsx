"use client";

import { useRef, useState } from "react";
import {
  type WarehouseBalance,
  type WarehouseCommand,
  type WarehouseError,
  type WarehouseIncoming,
  type WarehousePosition,
  type WarehouseResult,
  type WarehouseWorkspace,
  warehouseCommand,
} from "../contracts";
import { WarehouseWorkspaceView } from "./WarehouseWorkspaceView";

const fixtureId = (suffix: number) => `20000000-1111-4111-8111-${String(suffix).padStart(12, "0")}`;
const north = fixtureId(1);
const racks = fixtureId(2);
const bench = fixtureId(3);
const partA = fixtureId(4);
const partB = fixtureId(5);

function sample(canManage: boolean): WarehouseWorkspace {
  const initial: WarehouseWorkspace = {
    sites: [{ id: north, code: "NORTH", name: "North warehouse", archived: false, canManage }],
    locations: [
      {
        id: racks,
        siteId: north,
        parentId: null,
        code: "RACK-A",
        name: "Rack A",
        archived: false,
        kind: "storage",
      },
      {
        id: bench,
        siteId: north,
        parentId: null,
        code: "BENCH",
        name: "Receiving bench",
        archived: false,
        kind: "external",
      },
    ],
    parts: [
      {
        id: partA,
        code: "PLC-120",
        sku: "PLC-120",
        name: "Compact PLC",
        revision: "A",
        kind: "product",
        trackable: false,
        canReceive: true,
      },
      {
        id: partB,
        code: "PLC-120",
        sku: "PLC-120-B",
        name: "Compact PLC",
        revision: "B",
        kind: "product",
        trackable: true,
        canReceive: true,
      },
    ],
    positions: [
      {
        id: fixtureId(6),
        siteId: north,
        locationId: racks,
        itemId: partA,
        lot: "RUN-01",
        serial: null,
        expiryDate: null,
        state: "available",
        ownerOrganizationId: null,
        owned: false,
        onHand: 8,
        reserved: 3,
        available: 5,
      },
      {
        id: fixtureId(7),
        siteId: north,
        locationId: racks,
        itemId: partB,
        lot: "RUN-02",
        serial: "PLC-120-0001",
        expiryDate: null,
        state: "quarantine",
        ownerOrganizationId: null,
        owned: false,
        onHand: 1,
        reserved: 0,
        available: 0,
      },
    ],
    incoming: [
      {
        id: fixtureId(8),
        itemId: partA,
        siteId: north,
        locationId: racks,
        quantity: 12,
        received: 0,
        cancelled: false,
        expectedDate: null,
        reference: "DEMO-301",
        ownerOrganizationId: null,
        owned: false,
      },
    ],
    organizations: [{ id: fixtureId(9), name: "Demo manufacturing partner" }],
    canManageUnlocated: canManage,
    balances: canManage
      ? [
          {
            itemId: partA,
            siteId: null,
            locationId: null,
            onHand: 6,
            reserved: 2,
            available: 4,
            incoming: 0,
          },
        ]
      : [],
  };
  return refreshBalances(initial);
}

export function WarehouseFixture({ canManage }: { canManage: boolean }) {
  const [initial] = useState(() => sample(canManage));
  const current = useRef(initial);

  function submit(raw: WarehouseCommand): Promise<WarehouseResult> {
    if (!canManage) return Promise.resolve(failure("unavailable"));
    const command = warehouseCommand.safeParse(raw);
    if (!command.success) return Promise.resolve(failure("invalid"));
    const result = applyCommand(current.current, command.data);
    if (result.ok) current.current = result.value;
    return Promise.resolve(result);
  }

  return <WarehouseWorkspaceView initial={initial} submit={submit} fixture />;
}

function failure(error: WarehouseError): WarehouseResult {
  return { ok: false, error };
}

function success(value: WarehouseWorkspace, focusId: string): WarehouseResult {
  return { ok: true, value: refreshBalances(value), focusId };
}

function refreshBalances(workspace: WarehouseWorkspace): WarehouseWorkspace {
  const previous = workspace.balances.filter(({ siteId }) => siteId === null);
  const totals = new Map<string, WarehouseBalance>();
  function balance(row: WarehousePosition | WarehouseIncoming) {
    const key = `${row.itemId}:${row.siteId}:${row.locationId}`;
    const existing = totals.get(key);
    if (existing !== undefined) return existing;
    const empty = {
      itemId: row.itemId,
      siteId: row.siteId,
      locationId: row.locationId,
      onHand: 0,
      reserved: 0,
      available: 0,
      incoming: 0,
    };
    totals.set(key, empty);
    return empty;
  }

  const today = new Date().toISOString().slice(0, 10);
  const positions = workspace.positions.map((position) => {
    const location = workspace.locations.find(({ id }) => id === position.locationId);
    const isSaleable =
      location?.kind === "storage" &&
      !position.owned &&
      position.state === "available" &&
      (position.expiryDate === null || position.expiryDate >= today);
    const available = isSaleable ? position.onHand - position.reserved : 0;
    const total = balance(position);
    total.onHand += position.onHand;
    total.reserved += position.reserved;
    total.available += available;
    return { ...position, available };
  });
  for (const planned of workspace.incoming) {
    if (!planned.cancelled && planned.quantity > planned.received)
      balance(planned).incoming += planned.quantity - planned.received;
  }
  return { ...workspace, positions, balances: [...previous, ...totals.values()] };
}

function applyCommand(workspace: WarehouseWorkspace, command: WarehouseCommand): WarehouseResult {
  switch (command.type) {
    case "receive":
    case "reconcile":
      return recordStock(workspace, command);
    case "saveLocationPolicy":
      return changePolicy(workspace, command);
    case "createIncoming":
      return recordIncoming(workspace, command);
    case "cancelIncoming": {
      const row = workspace.incoming.find(({ id }) => id === command.id);
      if (row === undefined || row.cancelled || row.received >= row.quantity)
        return failure("conflict");
      return success(
        {
          ...workspace,
          incoming: workspace.incoming.map((entry) =>
            entry.id === row.id ? { ...entry, cancelled: true } : entry,
          ),
        },
        row.id,
      );
    }
    case "setPositionState":
      return changePositionState(workspace, command);
  }
}

function recordIncoming(
  workspace: WarehouseWorkspace,
  command: Extract<WarehouseCommand, { type: "createIncoming" }>,
): WarehouseResult {
  const { itemId, locationId, quantity, expectedDate, reference, ownerOrganizationId } = command;
  const location = workspace.locations.find(
    ({ id }) => id === locationId && kindAcceptsStock(workspace, id),
  );
  if (!location) return failure("incompatibleLocation");
  if (!workspace.parts.some(({ id, canReceive }) => id === itemId && canReceive))
    return failure("invalid");
  const id = crypto.randomUUID();
  const incoming = [
    ...workspace.incoming,
    {
      id,
      itemId,
      locationId,
      siteId: location.siteId,
      quantity,
      expectedDate,
      reference,
      ownerOrganizationId,
      owned: ownerOrganizationId !== null,
      received: 0,
      cancelled: false,
    },
  ];
  return success({ ...workspace, incoming }, id);
}

function changePolicy(
  workspace: WarehouseWorkspace,
  command: Extract<WarehouseCommand, { type: "saveLocationPolicy" }>,
): WarehouseResult {
  const { locationId, kind } = command;
  if (
    kind === "structure" &&
    (workspace.positions.some((row) => row.locationId === locationId && row.onHand > 0) ||
      workspace.incoming.some(
        (row) => row.locationId === locationId && !row.cancelled && row.quantity > row.received,
      ))
  )
    return failure("incompatibleLocation");
  if (
    kind !== "storage" &&
    workspace.positions.some((row) => row.locationId === locationId && row.reserved > 0)
  )
    return failure("incompatibleLocation");
  const locations = workspace.locations.map((entry) =>
    entry.id === locationId ? { ...entry, kind } : entry,
  );
  return success({ ...workspace, locations }, locationId);
}

function kindAcceptsStock(workspace: WarehouseWorkspace, locationId: string) {
  const location = workspace.locations.find(({ id }) => id === locationId);
  return location !== undefined && location.kind !== "structure";
}

function changePositionState(
  workspace: WarehouseWorkspace,
  { id, quantity, state }: Extract<WarehouseCommand, { type: "setPositionState" }>,
): WarehouseResult {
  const position = workspace.positions.find((row) => row.id === id);
  if (!position) return failure("invalid");
  if (quantity > position.onHand - position.reserved) return failure("insufficientStock");
  if (state === position.state) return success(workspace, id);
  if (quantity === position.onHand) {
    const positions = workspace.positions.map((row) => (row.id === id ? { ...row, state } : row));
    return success({ ...workspace, positions }, id);
  }
  const next = { ...position, id: crypto.randomUUID(), onHand: quantity, reserved: 0, state };
  const positions = workspace.positions.map((row) =>
    row.id === id ? { ...row, onHand: row.onHand - quantity } : row,
  );
  return success({ ...workspace, positions: [...positions, next] }, next.id);
}

function recordStock(
  workspace: WarehouseWorkspace,
  command: Extract<WarehouseCommand, { type: "receive" | "reconcile" }>,
): WarehouseResult {
  const { locationId, itemId, quantity, lot, serial, expiryDate, state, ownerOrganizationId } =
    command;
  const location = workspace.locations.find(({ id }) => id === locationId);
  const part = workspace.parts.find(({ id }) => id === itemId);
  if (!location || location.kind === "structure") return failure("incompatibleLocation");
  if (
    part?.canReceive !== true ||
    (part.trackable && serial === null) ||
    (serial !== null && quantity !== 1)
  )
    return failure("invalid");
  if (
    serial !== null &&
    workspace.positions.some((row) => row.itemId === itemId && row.serial === serial)
  )
    return failure("duplicateSerial");
  const adjusted =
    command.type === "reconcile"
      ? reconcile(workspace, itemId, quantity)
      : receivePlan(workspace, command);
  if (!adjusted.ok) return adjusted;
  const id = crypto.randomUUID();
  const pos: WarehousePosition = {
    id,
    siteId: location.siteId,
    locationId,
    itemId,
    lot,
    serial,
    expiryDate,
    state,
    ownerOrganizationId,
    owned: ownerOrganizationId !== null,
    onHand: quantity,
    reserved: 0,
    available: 0,
  };
  return success({ ...adjusted.value, positions: [...workspace.positions, pos] }, id);
}

function reconcile(
  workspace: WarehouseWorkspace,
  itemId: string,
  quantity: number,
): WarehouseResult {
  const legacy = workspace.balances.find((row) => row.siteId === null && row.itemId === itemId);
  if (!legacy || quantity > legacy.onHand - legacy.reserved) return failure("insufficientStock");
  const balance = {
    ...legacy,
    onHand: legacy.onHand - quantity,
    available: legacy.available - quantity,
  };
  return {
    ok: true,
    value: {
      ...workspace,
      balances: workspace.balances.map((row) => (row === legacy ? balance : row)),
    },
  };
}

function receivePlan(
  workspace: WarehouseWorkspace,
  command: Extract<WarehouseCommand, { type: "receive" }>,
): WarehouseResult {
  if (command.incomingId === null) return { ok: true, value: workspace };
  const planned = workspace.incoming.find(({ id }) => id === command.incomingId);
  if (
    !planned ||
    planned.cancelled ||
    planned.itemId !== command.itemId ||
    planned.locationId !== command.locationId ||
    planned.ownerOrganizationId !== command.ownerOrganizationId ||
    command.quantity > planned.quantity - planned.received
  )
    return failure("planMismatch");
  const incoming = workspace.incoming.map((row) =>
    row === planned ? { ...row, received: row.received + command.quantity } : row,
  );
  return { ok: true, value: { ...workspace, incoming } };
}
