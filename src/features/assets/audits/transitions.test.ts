import { describe, expect, it } from "vitest";
import type { EquipmentAuditCommand, EquipmentAuditDetail, EquipmentAuditScope } from "./contracts";
import {
  auditFixtureData,
  auditFixtureParticipants,
  changeLiveAuditDemoEquipment,
} from "./fixtureData";
import { lookupAuditEquipment, projectAuditDetail, projectAuditWorkspace } from "./projection";
import { snapshotAuditRows } from "./snapshot";
import {
  type AuditEquipmentResolver,
  type AuditFixtureActor,
  type AuditFixtureState,
  createAuditFixtureState,
} from "./state";
import { applyAuditCommand, applyAuditPhoto, attachAuditPhoto } from "./transitions";

const managerId = "5900afd8-320d-4692-8bad-42d634b2ad59";
const now = "2026-11-23T08:00:00.000Z";
const clock = { now, makeId: () => crypto.randomUUID() };

function accepted<T extends { ok: true } | { ok: false; error: string }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result as Extract<T, { ok: true }>;
}

function initial() {
  const { assets, siteId, roster, scope } = auditFixtureData();
  const state = createAuditFixtureState(assets, roster);
  const { mara, elias, unassigned } = auditFixtureParticipants;
  const manager: AuditFixtureActor = {
    id: managerId,
    name: "Audit manager",
    roles: { [siteId]: "manager" },
  };
  const base: AuditFixtureActor = { ...mara, roles: { [siteId]: "base" } };
  const self: AuditFixtureActor = { ...elias, roles: { [siteId]: "self_service" } };
  const outside: AuditFixtureActor = { ...unassigned, roles: { [siteId]: "base" } };
  const resolve: AuditEquipmentResolver = (site, code) => {
    const asset = assets.records.find((row) => row.siteId === site && row.code === code);
    const kit = assets.kits?.records.find((row) => row.siteId === site && row.code === code);
    if (asset !== undefined) return { id: asset.id, kind: "asset" };
    return kit === undefined ? null : { id: kit.id, kind: "kit" };
  };
  const audit = accepted(
    applyAuditCommand(
      state,
      manager,
      {
        type: "create",
        siteId,
        title: "Physical test bench audit",
        dueAt: null,
        scope,
        assigneeIds: [base.id, self.id],
        requestId: clock.makeId(),
      },
      { ...clock, resolve },
    ),
  );
  return { ...audit, siteId, manager, base, self, outside, resolve };
}

type Context = Pick<ReturnType<typeof initial>, "state" | "detail" | "resolve">;
type Existing = Exclude<EquipmentAuditCommand, { type: "create" }>;
type Payload<T = Existing> = T extends Existing
  ? Omit<T, "auditId" | "version" | "requestId">
  : never;

function request(context: Context, payload: Payload): Existing {
  return {
    ...payload,
    auditId: context.detail.id,
    version: context.detail.version,
    requestId: clock.makeId(),
  };
}

function apply(context: Context, actor: AuditFixtureActor, payload: Payload) {
  return applyAuditCommand(context.state, actor, request(context, payload), {
    ...clock,
    resolve: context.resolve,
  });
}

function rowFor(detail: EquipmentAuditDetail, code: string, placement?: string) {
  const row = detail.rows.find(
    (candidate) =>
      candidate.target?.code === code &&
      (placement === undefined || candidate.placement.label === placement),
  );
  if (row === undefined) throw new Error(`Missing equipment ${code}`);
  return row;
}

function start(pending: ReturnType<typeof initial>) {
  return { ...pending, ...accepted(apply(pending, pending.base, { type: "start" })) };
}

describe("Scoped physical equipment audits", () => {
  it("snapshots each loose, kit, and custody slice once even when selectors overlap", () => {
    const { assets, siteId, scope } = auditFixtureData();
    const warehouse = assets.locations.find(({ code }) => code === "WAREHOUSE");
    const bin = assets.locations.find(({ code }) => code === "A-01");
    const ferrule = assets.records.find(({ code }) => code === "FERRULE-1");
    const kit = assets.kits?.records[0];
    const meter = assets.records.find(({ code }) => code === "METER-101");
    if (
      warehouse === undefined ||
      bin === undefined ||
      ferrule === undefined ||
      kit === undefined ||
      meter === undefined
    )
      throw new Error("Missing audit fixture");
    const selection: EquipmentAuditScope = {
      ...scope,
      tag: null,
      locationIds: [warehouse.id, bin.id],
      assetIds: [ferrule.id, meter.id],
      kitIds: [kit.id],
      includeCustody: false,
    };
    const snapshot = snapshotAuditRows(assets, siteId, selection, clock.makeId);
    expect(snapshot.filter(({ target }) => target?.id === meter.id)).toHaveLength(1);
    expect(
      snapshot
        .filter(({ target }) => target?.id === ferrule.id)
        .map(({ placement, expected }) => ({
          kind: placement.kind,
          expected,
        })),
    ).toEqual([
      { kind: "storage", expected: 97 },
      { kind: "kit", expected: 3 },
    ]);
    expect(snapshot.some(({ target }) => target?.code === "THERMAL-201")).toBe(false);
    const fullSite = snapshotAuditRows(
      assets,
      siteId,
      { ...scope, tag: null, includeCustody: true },
      clock.makeId,
    );
    expect(fullSite.filter(({ target }) => target?.code === "THERMAL-201")).toEqual([
      expect.objectContaining({
        expected: 1,
        placement: expect.objectContaining({ kind: "custody" }) as unknown,
      }),
    ]);
  });

  it("permits assigned operators, freezes start data, and hides the catalog from an assigned role", () => {
    const pending = initial();
    expect(projectAuditDetail(pending.state, pending.outside, pending.detail.id)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(projectAuditWorkspace(pending.state, pending.outside).sites).toEqual([]);
    expect(apply(pending, pending.outside, { type: "start" })).toEqual({
      ok: false,
      error: "unavailable",
    });
    const active = start(pending);
    const bench = rowFor(active.detail, "METER-101");
    const state = { ...active.state, assets: changeLiveAuditDemoEquipment(active.state.assets) };
    const newView = accepted(projectAuditDetail(state, active.self, active.detail.id)).value;
    expect(rowFor(newView, "METER-101")).toEqual(bench);
    expect(newView.canCount).toBe(true);
    expect(projectAuditWorkspace(state, active.self).sites[0]).toMatchObject({
      canManage: false,
      targets: [],
      locations: [],
      auditors: [],
    });
    const removed: AuditFixtureState = {
      ...state,
      participants: { [pending.siteId]: [pending.base] },
    };
    expect(projectAuditDetail(removed, active.self, active.detail.id)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("records increments, recounts, and duplicate serial scans with atomic batch and replay", () => {
    const active = start(initial());
    const bench = rowFor(active.detail, "METER-101");
    const pool = rowFor(active.detail, "LEAD-SET", "Bin A-01");
    const count = request(active, {
      type: "setCount",
      rowId: pool.id,
      quantity: 3,
      mode: "add",
      proof: null,
    });
    const first = accepted(
      applyAuditCommand(active.state, active.self, count, { ...clock, resolve: active.resolve }),
    );
    expect(rowFor(first.detail, "LEAD-SET", "Bin A-01").counted).toBe(3);
    expect(
      accepted(
        applyAuditCommand(first.state, active.self, count, { ...clock, resolve: active.resolve }),
      ).applied,
    ).toBe(false);
    expect(
      applyAuditCommand(
        first.state,
        active.self,
        { ...count, requestId: clock.makeId() },
        { ...clock, resolve: active.resolve },
      ),
    ).toEqual({ ok: false, error: "stale" });
    const current = { ...active, ...first };
    const blocked = apply(current, active.base, {
      type: "bulkCount",
      counts: [
        { rowId: pool.id, quantity: 7 },
        { rowId: bench.id, quantity: 2 },
      ],
    });
    expect(blocked).toEqual({ ok: false, error: "quantity" });
    expect(rowFor(current.detail, "LEAD-SET", "Bin A-01").counted).toBe(3);
    const delta = accepted(
      apply(current, active.base, {
        type: "setCount",
        rowId: pool.id,
        quantity: 2,
        mode: "add",
        proof: null,
      }),
    );
    const over = accepted(
      apply({ ...current, ...delta }, active.self, {
        type: "setCount",
        rowId: pool.id,
        quantity: 13,
        mode: "replace",
        proof: null,
      }),
    );
    expect(over.detail.progress.unexpectedUnits).toBe(1);
    expect(over.detail.activity[0]).toMatchObject({
      actor: active.self.name,
      before: 5,
      after: 13,
    });
    const scanned = {
      type: "setCount",
      rowId: bench.id,
      quantity: 1,
      mode: "add",
      proof: { code: "METER-101", expectedTargetId: bench.target?.id ?? null },
    } as const;
    const found = accepted(apply({ ...current, ...over }, active.self, scanned));
    const repeated = accepted(apply({ ...current, ...found }, active.self, scanned));
    expect(repeated.detail.version).toBe(found.detail.version);
    expect(repeated.detail.activity).toEqual(found.detail.activity);
    const changedTag: AuditEquipmentResolver = (site, code) =>
      active.resolve(site, code === "METER-101" ? "FERRULE-1" : code);
    expect(apply({ ...current, ...found, resolve: changedTag }, active.self, scanned)).toEqual({
      ok: false,
      error: "conflict",
    });
  });

  it("keeps a wrong or unpermitted scan opaque and preserves note/photo evidence after undo", () => {
    const active = start(initial());
    const unknown = lookupAuditEquipment(
      active.state,
      active.base,
      active.detail.id,
      "FERRULE-1",
      active.resolve,
    );
    expect(unknown).toEqual({ ok: true, targetId: null, rows: [], label: null });
    expect(
      lookupAuditEquipment(
        active.state,
        active.manager,
        active.detail.id,
        "FERRULE-1",
        active.resolve,
      ),
    ).toMatchObject({ ok: true, label: expect.any(String) as unknown });
    const counted = accepted(
      apply(active, active.base, {
        type: "unexpected",
        code: "FERRULE-1",
        expectedTargetId: null,
        locationId: null,
        quantity: 2,
      }),
    );
    const newRow = counted.detail.rows.find(({ result }) => result === "unexpected");
    if (newRow === undefined) throw new Error("Missing unexpected row");
    expect(newRow.target).toBeNull();
    const noted = accepted(
      apply({ ...active, ...counted }, active.self, {
        type: "note",
        rowId: newRow.id,
        note: "Wrong label by door",
      }),
    );
    const photo = {
      auditId: noted.detail.id,
      rowId: newRow.id,
      version: noted.detail.version,
      requestId: clock.makeId(),
      name: "Door.jpg",
      href: "blob:https://app.test/private",
      fingerprint: "test-image-bytes",
      source: "camera",
    };
    const attached = accepted(attachAuditPhoto(noted.state, active.self, photo, clock));
    expect(attachAuditPhoto(attached.state, active.outside, photo, clock)).toEqual({
      ok: false,
      error: "unavailable",
    });
    const undone = accepted(
      apply({ ...active, ...attached }, active.base, {
        type: "undo",
        rowId: newRow.id,
        reason: "Count repeated",
      }),
    );
    expect(undone.detail.rows.some(({ id }) => id === newRow.id)).toBe(false);
    expect(undone.detail.progress.unexpectedRows).toBe(0);
    expect(undone.detail.evidence).toEqual(attached.detail.evidence);
    expect(undone.detail.activity.slice(0, 3).map(({ kind }) => kind)).toEqual([
      "undone",
      "photo",
      "note",
    ]);
  });

  it("returns the full ordered batch for persistence and consumer-specific native evidence links", () => {
    const active = start(initial());
    const bench = rowFor(active.detail, "METER-101");
    const pool = rowFor(active.detail, "LEAD-SET", "Bin A-01");
    const input = request(active, {
      type: "bulkCount",
      counts: [
        { rowId: bench.id, quantity: 1 },
        { rowId: pool.id, quantity: 8 },
      ],
    });
    const batch = accepted(
      applyAuditCommand(active.state, active.self, input, { ...clock, resolve: active.resolve }),
    );
    expect(batch.change?.audit.version).toBe(active.detail.version + 1);
    expect(batch.change?.events.map(({ rowId, after }) => ({ rowId, after }))).toEqual([
      { rowId: pool.id, after: 8 },
      { rowId: bench.id, after: 1 },
    ]);
    expect(
      accepted(
        applyAuditCommand(batch.state, active.self, input, { ...clock, resolve: active.resolve }),
      ).change,
    ).toBeNull();

    const photo = accepted(
      applyAuditPhoto(
        batch.state,
        active.self,
        {
          auditId: batch.detail.id,
          rowId: bench.id,
          version: batch.detail.version,
          requestId: clock.makeId(),
          name: "Meter.png",
          fingerprint: "image-fingerprint",
          source: "file",
        },
        clock,
        (auditId, evidenceId) => `/api/assets/audits/${auditId}/evidence/${evidenceId}`,
      ),
    );
    const evidence = photo.detail.evidence[0];
    if (evidence === undefined) throw new Error("Missing evidence");
    expect(evidence.href).toBe(`/api/assets/audits/${batch.detail.id}/evidence/${evidence.id}`);
    expect(photo.change?.events.map(({ kind }) => kind)).toEqual(["photo"]);
  });

  it("uses the opaque scope key for lookup and avoids duplicate unresolved incidents in other bins", () => {
    const active = start(initial());
    const opaqueKeyFor = () => "a".repeat(64);
    const input = request(active, {
      type: "unexpected",
      code: "FERRULE-1",
      expectedTargetId: null,
      locationId: null,
      quantity: 2,
    });
    const flow = { ...clock, resolve: active.resolve, opaqueKeyFor };
    const first = accepted(applyAuditCommand(active.state, active.self, input, flow));
    const record = first.change?.audit;
    const hidden = record?.rows.find(({ expected }) => expected === null);
    if (hidden === undefined) throw new Error("Missing unresolved observation");
    expect(hidden.opaqueKey).toBe(opaqueKeyFor());
    expect(
      lookupAuditEquipment(
        first.state,
        active.self,
        active.detail.id,
        "FERRULE-1",
        active.resolve,
        opaqueKeyFor,
      ),
    ).toEqual({ ok: true, targetId: null, label: null, rows: [hidden.id] });

    const pool = rowFor(first.detail, "LEAD-SET", "Bin A-01");
    expect(pool.placement.locationId).not.toBeNull();
    const repeated = request(
      { ...active, ...first },
      {
        type: "unexpected",
        code: "FERRULE-1",
        expectedTargetId: null,
        locationId: pool.placement.locationId,
        quantity: 3,
      },
    );
    const duplicate = accepted(applyAuditCommand(first.state, active.self, repeated, flow));
    expect(duplicate.change?.events).toEqual([]);
    expect(duplicate.detail.progress.unexpectedRows).toBe(1);
    expect(duplicate.detail.progress.unexpectedUnits).toBe(2);
  });

  it("freezes missing results on completion and duplicates a clean unassigned draft", () => {
    const active = start(initial());
    expect(active.detail.progress.missingRows).toBe(0);
    const completed = accepted(
      apply(active, active.self, { type: "complete", note: "Inspection complete" }),
    );
    const current = { ...active, ...completed };
    expect(current.detail.progress.missingRows).toBe(active.detail.progress.expectedRows);
    expect(current.detail.canCount).toBe(false);
    const row = rowFor(current.detail, "METER-101");
    expect(
      apply(current, active.self, {
        type: "setCount",
        rowId: row.id,
        quantity: 1,
        mode: "replace",
        proof: null,
      }),
    ).toEqual({ ok: false, error: "state" });
    const reviewed = accepted(apply(current, active.manager, { type: "review", note: null }));
    const archived = accepted(
      apply({ ...current, ...reviewed }, active.manager, { type: "archive", archived: true }),
    );
    const duplicate = accepted(
      apply({ ...current, ...archived }, active.manager, {
        type: "duplicate",
        title: "Re-audit",
        dueAt: null,
      }),
    );
    expect(duplicate.detail).toMatchObject({
      status: "draft",
      rows: [],
      evidence: [],
      assignees: [],
      reviewedAt: null,
    });
    expect(duplicate.detail.id).not.toBe(current.detail.id);
    expect(duplicate.detail.scope).toEqual(current.detail.scope);
    expect(
      accepted(projectAuditDetail(duplicate.state, active.manager, current.detail.id)).value
        .archived,
    ).toBe(true);
  });
});
