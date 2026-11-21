import { describe, expect, it } from "vitest";
import type { AssetsWorkspace } from "../contracts";
import { assetsFixture } from "../fixtures";
import { type CustodyIntent, type CustodyResult, emptyCustodyWorkspace } from "./contracts";
import { applyCustodyCommand } from "./transitions";

function apply(workspace: AssetsWorkspace, intent: CustodyIntent) {
  return applyCustodyCommand(
    workspace,
    { ...intent, requestId: crypto.randomUUID() },
    "Custody operator",
  );
}

function success(result: CustodyResult) {
  if (!result.ok) throw new Error(`Expected custody success, received ${result.error}`);
  return result;
}

function find<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing custody test data");
  return value;
}

function seed() {
  const base = assetsFixture(true);
  const bin = find(base.locations.find(({ code }) => code === "A-01"));
  const receiving = find(base.locations.find(({ code }) => code === "RECEIVING"));
  const individual = find(base.records.find(({ code }) => code === "METER-101"));
  const pool = find(base.records.find(({ code }) => code === "LEAD-SET"));
  const foreign = find(base.records.find(({ siteId }) => siteId !== bin.siteId));
  const staff = { id: crypto.randomUUID(), name: "Staff technician" };
  const workspace = { ...base, custody: { ...emptyCustodyWorkspace(), staff: [staff] } };
  const person = {
    type: "saveCustodian" as const,
    siteId: bin.siteId,
    custodianId: null,
    version: null,
    active: true,
  };
  const withStaff = success(
    apply(workspace, { ...person, staffId: staff.id, name: "Client-supplied name" }),
  ).value;
  const value = success(
    apply(withStaff, { ...person, staffId: null, name: "External technician" }),
  ).value;
  const employee = find(value.custody.custodians.find(({ staffId }) => staffId === staff.id));
  const external = find(value.custody.custodians.find(({ staffId }) => staffId === null));
  return {
    value,
    siteId: bin.siteId,
    bin,
    receiving,
    individual,
    pool,
    foreign,
    employee,
    external,
  };
}

const handover = { condition: "good", note: null, locationId: null } as const;

describe("shared custody transitions", () => {
  it("retains registered storage and returns from an unlinked staff custodian", () => {
    const { value, siteId, individual, bin, receiving, employee, external } = seed();
    expect(employee).toMatchObject({ name: "Staff technician", kind: "staff" });
    const source = { siteId, assetId: individual.id, version: individual.version, quantity: 1 };
    const assigned = success(
      apply(value, {
        ...source,
        ...handover,
        type: "assign",
        custodianId: employee.id,
        locationId: receiving.id,
      }),
    ).value;
    expect(assigned.records.find(({ id }) => id === individual.id)).toMatchObject({
      version: individual.version + 1,
      locationId: bin.id,
    });
    const holding = find(assigned.custody.holdings[0]);
    expect(holding).toMatchObject({ sourceLocationId: bin.id, locationId: receiving.id });
    expect(
      apply(assigned, {
        ...source,
        ...handover,
        type: "assign",
        custodianId: external.id,
        version: individual.version + 1,
      }),
    ).toEqual({ ok: false, error: "held" });

    const removedAccount = {
      ...assigned,
      custody: {
        ...assigned.custody,
        staff: [],
        custodians: [{ ...employee, staffId: null }, external],
      },
    };
    const returned = success(
      apply(removedAccount, {
        ...source,
        ...handover,
        type: "return",
        holdingId: holding.id,
        version: individual.version + 1,
        condition: "worn",
        note: "Checked on receipt",
      }),
    ).value;
    expect(returned.custody.holdings).toHaveLength(0);
    const event = find(returned.custody.events[0]);
    const asset = find(returned.records.find(({ id }) => id === individual.id));
    expect(asset).toMatchObject({ version: individual.version + 2, locationId: bin.id });
    expect(asset.events[0]).toMatchObject({ id: event.id, kind: "updated" });
    expect(event).toMatchObject({
      action: "return",
      version: asset.version,
      fromCustodianName: "Staff technician",
      sourceLocationId: bin.id,
      locationId: bin.id,
      note: "Checked on receipt",
    });
    expect(
      apply(returned, {
        ...source,
        ...handover,
        type: "assign",
        custodianId: employee.id,
        version: asset.version,
      }),
    ).toEqual({ ok: false, error: "unavailable" });
  });

  it("conserves pool quantity across split custody, partial transfer and partial return", () => {
    const { value, siteId, pool, bin, receiving, employee, external } = seed();
    const target = { siteId, assetId: pool.id };
    const loaned = success(
      apply(value, {
        ...target,
        ...handover,
        type: "assign",
        version: pool.version,
        custodianId: employee.id,
        locationId: bin.id,
        quantity: 8,
      }),
    ).value;
    const origin = find(loaned.custody.holdings[0]);
    const transferred = success(
      apply(loaned, {
        ...target,
        ...handover,
        type: "transfer",
        version: pool.version + 1,
        holdingId: origin.id,
        custodianId: external.id,
        locationId: receiving.id,
        quantity: 3,
      }),
    ).value;
    const piece = find(
      transferred.custody.holdings.find(({ custodianId }) => custodianId === external.id),
    );
    expect(piece).toMatchObject({
      quantity: 3,
      sourceLocationId: bin.id,
      locationId: receiving.id,
    });
    expect(transferred.custody.events[0]).toMatchObject({
      holdingId: origin.id,
      destinationHoldingId: piece.id,
      quantity: 3,
    });
    const returned = success(
      apply(transferred, {
        ...target,
        ...handover,
        type: "return",
        version: pool.version + 2,
        holdingId: piece.id,
        locationId: receiving.id,
        quantity: 2,
      }),
    ).value;
    expect(returned.custody.holdings).toEqual([
      expect.objectContaining({ id: origin.id, quantity: 5 }),
      expect.objectContaining({ id: piece.id, quantity: 1 }),
    ]);
    expect(returned.records.find(({ id }) => id === pool.id)).toMatchObject({
      balances: [
        { locationId: bin.id, quantity: 4 },
        { locationId: receiving.id, quantity: 10 },
      ],
    });
    expect(
      apply(returned, {
        ...target,
        ...handover,
        type: "return",
        version: pool.version + 3,
        holdingId: piece.id,
        quantity: 2,
      }),
    ).toEqual({ ok: false, error: "quantity" });
  });

  it("reports ordered individual bulk outcomes without mutating hidden or incompatible records", () => {
    const { value, siteId, individual, pool, foreign, external } = seed();
    const selected = [pool, foreign, individual].map(({ id, version }) => ({
      assetId: id,
      version,
    }));
    const result = success(
      apply(value, {
        ...handover,
        type: "bulkAssign",
        siteId,
        assets: selected,
        custodianId: external.id,
      }),
    );
    expect(result.outcomes).toEqual([
      { assetId: pool.id, ok: false, error: "ineligible" },
      { assetId: foreign.id, ok: false, error: "unavailable" },
      { assetId: individual.id, ok: true },
    ]);
    const returned = success(
      apply(result.value, {
        ...handover,
        type: "bulkReturn",
        siteId,
        assets: selected,
      }),
    );
    expect(returned.outcomes.at(-1)).toEqual({ assetId: individual.id, ok: false, error: "stale" });
    expect(returned.value.custody.holdings).toHaveLength(1);
  });

  it("retains handover names and private notes across edits to a non-login custodian", () => {
    const { value, siteId, individual, external } = seed();
    const assigned = success(
      apply(value, {
        ...handover,
        type: "assign",
        siteId,
        assetId: individual.id,
        version: individual.version,
        custodianId: external.id,
        quantity: 1,
      }),
    ).value;
    const noted = success(
      apply(assigned, {
        type: "noteCustodian",
        siteId,
        custodianId: external.id,
        note: "Contact through the workshop",
      }),
    ).value;
    const edited = success(
      apply(noted, {
        type: "saveCustodian",
        siteId,
        custodianId: external.id,
        version: external.version,
        staffId: null,
        name: "Workshop technician",
        active: false,
      }),
    ).value;
    expect(edited.custody.custodians.find(({ id }) => id === external.id)).toMatchObject({
      name: "Workshop technician",
      kind: "non_login",
      active: false,
      version: external.version + 1,
    });
    expect(edited.custody.notes).toEqual([
      expect.objectContaining({
        custodianId: external.id,
        note: "Contact through the workshop",
        actor: "Custody operator",
      }),
    ]);
    expect(edited.custody.events[0]).toMatchObject({ toCustodianName: "External technician" });
    expect(edited.custody.holdings[0]).toMatchObject({ custodianId: external.id, quantity: 1 });
  });
});
