import { describe, expect, test } from "vitest";
import { auditFixtureParticipants, changeLiveAuditDemoEquipment } from "../fixtureData";
import type { AuditActor } from "../state";
import { assetAuditHistoryFixture, assetAuditHistoryFixtureId } from "./fixture";
import { assetAuditHistoryEntry, projectAssetAuditHistory } from "./projection";

const meterId = "1f07c542-849d-42d9-85c0-56b3ced383fd";
const leadId = "a979c5af-1605-45e4-84e9-9667b4a386c2";

describe("equipment audit histories", () => {
  test("keeps each frozen bin and original, undone and recounted quantities after live drift", () => {
    const { state, manager, auditor } = assetAuditHistoryFixture();
    const register = changeLiveAuditDemoEquipment(state.assets);
    const leads = projectAssetAuditHistory(state, manager, register, leadId);
    expect(leads).toMatchObject({
      ok: true,
      entries: [
        {
          auditId: assetAuditHistoryFixtureId,
          title: "Instrument corner recount",
          status: "completed",
          archived: true,
          findings: [
            {
              expected: 12,
              counted: 7,
              result: "partial",
              activity: [
                { kind: "counted", before: null, after: 4, actor: auditor.name },
                {
                  kind: "undone",
                  before: 4,
                  after: null,
                  note: "Counted a sealed pack twice.",
                  actor: auditor.name,
                },
                { kind: "counted", before: null, after: 7, actor: auditor.name },
              ],
            },
            { expected: 8, counted: null, result: "missing", activity: [] },
          ],
        },
      ],
    });
    const meter = projectAssetAuditHistory(state, manager, register, meterId);
    expect(meter).toMatchObject({
      ok: true,
      entries: [{ findings: [{ serial: "M87-QA-0101", result: "found" }] }],
    });
    expect(JSON.stringify(meter)).not.toContain("Bench meter after relocation");
    expect(JSON.stringify(leads)).not.toContain("evidence");
    expect(JSON.stringify(leads)).not.toContain("M87-QA-0101");
  });

  test("requires both exact asset visibility and a current audit assignment or manager grant", () => {
    const { state, manager, auditor } = assetAuditHistoryFixture();
    const register = state.assets;
    const unassigned: AuditActor = { ...auditFixtureParticipants.elias, roles: auditor.roles };
    const viewer: AuditActor = { ...manager, roles: {} };
    expect(projectAssetAuditHistory(state, viewer, register, meterId)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(projectAssetAuditHistory(state, auditor, { ...register, records: [] }, meterId)).toEqual(
      { ok: false, error: "unavailable" },
    );
    expect(projectAssetAuditHistory(state, unassigned, register, meterId)).toEqual({
      ok: true,
      entries: [],
    });
    expect(projectAssetAuditHistory(state, auditor, register, meterId)).toMatchObject({
      ok: true,
      entries: [{ auditId: assetAuditHistoryFixtureId }],
    });
  });

  test("retains a known unexpected count once undone, without linking unidentified equipment", () => {
    const { state } = assetAuditHistoryFixture();
    const [audit] = state.audits;
    if (audit === undefined) throw new Error("Missing completed fixture audit");
    const recorded = audit.rows.find((row) => row.target?.id === meterId);
    if (recorded === undefined) throw new Error("Missing exact fixture row");
    const firstCount = audit.activity.find(
      (event) => event.rowId === recorded.id && event.kind === "counted",
    );
    if (firstCount === undefined) throw new Error("Missing exact fixture count");
    const neverCounted = { ...recorded, id: "unused", expected: null, counted: null };
    const undone = { ...recorded, expected: null, counted: null };
    const unknown = { ...recorded, id: "unknown", target: null, expected: null, counted: 1 };
    const projected = assetAuditHistoryEntry(
      {
        ...audit,
        rows: [neverCounted, undone, unknown],
        activity: [
          { ...firstCount, id: "correction", kind: "undone", before: 1, after: null },
          { ...firstCount, kind: "unexpected" },
        ],
      },
      meterId,
    );
    expect(projected?.findings).toMatchObject([
      {
        id: undone.id,
        result: "withdrawn",
        expected: null,
        counted: null,
        activity: [
          { kind: "unexpected", after: 1 },
          { kind: "undone", after: null },
        ],
      },
    ]);
    expect(
      assetAuditHistoryEntry({ ...audit, status: "active", completedAt: null }, meterId),
    ).toBeNull();
  });
});
