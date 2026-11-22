import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { EquipmentAuditIntent } from "../contracts";
import { auditFixtureData, auditFixtureParticipants } from "../fixtureData";
import { type AuditActor, createAuditState } from "../state";
import { applyAuditCommand } from "../transitions";

function fixtureId(sequence: number) {
  return `8dba2243-c2be-4768-b22c-${String(sequence).padStart(12, "0")}`;
}

export const assetAuditHistoryFixtureId = fixtureId(1);

export function assetAuditHistoryFixture(data = auditFixtureData()) {
  const { assets, siteId, roster } = data;
  const meter = assets.records.find(({ code }) => code === "METER-101");
  const lead = assets.records.find(({ code }) => code === "LEAD-SET");
  const bin = assets.locations.find(({ code }) => code === "A-01");
  if (meter === undefined || lead === undefined || bin === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing equipment audit history fixture assets");
  }

  const manager: AuditActor = {
    id: fixtureId(900),
    name: "Demo equipment manager",
    roles: { [siteId]: "manager" },
  };
  const auditor: AuditActor = { ...auditFixtureParticipants.mara, roles: { [siteId]: "base" } };
  let state = createAuditState(assets, roster);
  let sequence = 1;
  let step = 0;
  function run(actor: AuditActor, intent: EquipmentAuditIntent) {
    const result = applyAuditCommand(
      state,
      actor,
      { ...intent, requestId: fixtureId(100 + step) },
      {
        now: new Date(Date.UTC(2026, 10, 18, 9, step++)).toISOString(),
        makeId: () => fixtureId(sequence++),
        resolve: () => null,
      },
    );
    if (!result.ok)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Could not seed equipment audit history");
    state = result.state;
    return result.detail;
  }

  const draft = run(manager, {
    type: "create",
    siteId,
    title: "Instrument corner recount",
    dueAt: null,
    scope: { ...data.scope, assetIds: [meter.id, lead.id], tag: null },
    assigneeIds: [auditor.id],
  });
  const auditId = draft.id;
  const active = run(auditor, { type: "start", auditId, version: draft.version });
  const meterRow = active.rows.find(({ target }) => target?.id === meter.id);
  const leadRow = active.rows.find(
    ({ target, placement }) => target?.id === lead.id && placement.locationId === bin.id,
  );
  if (meterRow === undefined || leadRow === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Could not snapshot equipment audit history");
  }

  const first = run(auditor, {
    type: "bulkCount",
    auditId,
    version: active.version,
    counts: [
      { rowId: meterRow.id, quantity: 1 },
      { rowId: leadRow.id, quantity: 4 },
    ],
  });
  const undone = run(auditor, {
    type: "undo",
    auditId,
    version: first.version,
    rowId: leadRow.id,
    reason: "Counted a sealed pack twice.",
  });
  const recounted = run(auditor, {
    type: "setCount",
    auditId,
    version: undone.version,
    rowId: leadRow.id,
    quantity: 7,
    mode: "replace",
    proof: null,
  });
  const complete = run(auditor, {
    type: "complete",
    auditId,
    version: recounted.version,
    note: null,
  });
  run(manager, { type: "archive", auditId, version: complete.version, archived: true });
  return { state, manager, auditor };
}
