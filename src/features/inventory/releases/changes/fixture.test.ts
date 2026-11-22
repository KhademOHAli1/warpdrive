import { assert, expect, it } from "vitest";
import { inventoryFixture } from "../../fixtures";
import type { ReleaseArtifact } from "../contracts";
import { createReleaseFixture } from "../fixtures";
import type { EngineeringChangeCommand, EngineeringChangeResult } from "./contracts";
import { createEngineeringChangeFixture } from "./fixture";

const viewer = {
  id: "viewer",
  name: "Reader",
  canView: true,
  canPropose: false,
  canDecide: false,
  visibleSites: [] as string[],
  dispositionSites: [] as string[],
};
const engineer = { ...viewer, id: "engineering", name: "Engineering", canPropose: true };
const approver = { ...viewer, id: "approval", name: "Approval", canDecide: true };
const stock = {
  ...viewer,
  id: "stock",
  name: "Warehouse",
  visibleSites: ["berlin"],
  dispositionSites: ["berlin"],
};
const effectiveAt = "2030-01-01T11:00:00.000Z";

function unwrap<T>(result: EngineeringChangeResult<T>) {
  assert(result.ok);
  return result.value;
}

function setup() {
  const item = inventoryFixture(undefined).items.find(({ sku }) => sku === "IO-24-DIN");
  assert(item !== undefined);
  const { id: itemId, sku } = item;
  const initial = createReleaseFixture(item);
  const [base, draft] = initial.releases;
  const fabrication = base?.artifacts.find(({ kind }) => kind === "pcbFabrication");
  assert(base !== undefined && draft !== undefined && fabrication !== undefined);
  let state = initial;
  const changeCandidate = (quantity: number, ready = true) => {
    const bytes = new Blob([`sku,quantity\nPCB-IO-24,${quantity}\nENC-DIN-01,1\nLBL-IO-24,1\n`]);
    const artifacts: ReleaseArtifact[] = [
      {
        id: `b-bom-${quantity}`,
        kind: "manufacturingBom",
        name: "B-bom.csv",
        sizeBytes: bytes.size,
        bytes,
      },
    ];
    if (ready) artifacts.push({ ...fabrication, id: "b-gerber", name: "B-board.zip" });
    state = { ...state, releases: [base, { ...draft, artifacts }] };
  };
  changeCandidate(2);
  let now = Date.parse("2030-01-01T10:00:00.000Z");
  const fixture = createEngineeringChangeFixture({
    product: (id) => (id === itemId ? { sku, state } : undefined),
    sealPackage(id, candidate, approvedAt) {
      if (id !== itemId || !state.releases.includes(candidate)) return false;
      state = {
        ...state,
        releases: state.releases.map((release) =>
          release === candidate
            ? { ...release, status: "released", releasedAt: approvedAt }
            : release,
        ),
      };
      return true;
    },
    now: () => now,
  });
  return {
    fixture,
    itemId,
    changeCandidate,
    candidateId: `${itemId}:B`,
    time: (time: number) => {
      now = time;
    },
    state: () => state,
  };
}

it("requires the reviewed package, retains attributed decisions and preserves the old build pin across cutover", async () => {
  const { fixture, itemId, candidateId, changeCandidate, time, state } = setup();
  const edit = fixture.access(() => engineer);
  const decide = fixture.access(() => approver);
  const first = unwrap(await edit.preview(itemId, candidateId));
  expect(first.materials[0]?.after?.quantity).toBe("2");
  const submit: EngineeringChangeCommand = {
    type: "submit",
    itemId,
    requestId: "sub",
    candidateReleaseId: candidateId,
    baseReleaseId: first.base.id,
    fingerprint: first.fingerprint,
    effectiveAt,
    reason: "Correct the Rev B component count",
  };
  const submitted = unwrap(await edit.execute(submit)).changes[0];
  assert(submitted !== undefined);
  expect(unwrap(await edit.execute(submit)).changes).toEqual([submitted]);
  expect(fixture.hasChangeControl(itemId)).toBe(true);
  changeCandidate(3);
  const approve = {
    type: "approve",
    itemId,
    changeId: submitted.id,
    expectedVersion: 1,
    fingerprint: first.fingerprint,
    requestId: "approval",
  } as const;
  expect(await decide.execute(approve)).toEqual({ ok: false, error: "staleReview" });
  const returned = unwrap(
    await decide.execute({
      type: "return",
      itemId,
      changeId: submitted.id,
      expectedVersion: 1,
      requestId: "return",
      note: "Confirm the revised count.",
    }),
  ).changes[0];
  assert(returned?.status === "returned");
  const newer = unwrap(await edit.preview(itemId, candidateId));
  const resubmitted = unwrap(
    await edit.execute({
      ...submit,
      requestId: "resubmit",
      fingerprint: newer.fingerprint,
      revise: { changeId: returned.id, expectedVersion: returned.version },
    }),
  ).changes[0];
  assert(resubmitted?.status === "review");
  const approved = unwrap(
    await decide.execute({
      ...approve,
      expectedVersion: resubmitted.version,
      fingerprint: newer.fingerprint,
    }),
  );
  expect(approved.changes[0]?.history.map(({ type, actor }) => [type, actor])).toEqual([
    ["submitted", "Engineering"],
    ["returned", "Approval"],
    ["submitted", "Engineering"],
    ["approved", "Approval"],
  ]);
  expect(approved.effectiveRelease?.revision).toBe("A");
  expect(state().releases[1]?.status).toBe("released");
  time(Date.parse(effectiveAt) - 1);
  expect(fixture.effectiveRevision(itemId, state().activeRevision)).toBe("A");
  time(Date.parse(effectiveAt));
  expect(fixture.effectiveRevision(itemId, state().activeRevision)).toBe("B");
  expect(state().builds).toEqual([{ id: "BUILD-001", revision: "A" }]);
});

it("admits one racing review and protects old stock by current site and reservation authority", async () => {
  const { fixture, itemId, candidateId, changeCandidate, time } = setup();
  const edit = fixture.access(() => engineer);
  changeCandidate(2, false);
  const incomplete = unwrap(await edit.preview(itemId, candidateId));
  const submit: EngineeringChangeCommand = {
    type: "submit",
    itemId,
    requestId: "sub",
    candidateReleaseId: candidateId,
    baseReleaseId: incomplete.base.id,
    fingerprint: incomplete.fingerprint,
    effectiveAt,
    reason: "Update materials",
  };
  expect(await edit.execute(submit)).toEqual({ ok: false, error: "packageIncomplete" });
  changeCandidate(2);
  const review = unwrap(await edit.preview(itemId, candidateId));
  const command = { ...submit, fingerprint: review.fingerprint };
  const raced = await Promise.all([
    edit.execute(command),
    edit.execute({ ...command, requestId: "other" }),
  ]);
  expect(raced.filter(({ ok }) => ok)).toHaveLength(1);
  const change = unwrap(await edit.read(itemId)).changes[0];
  assert(change !== undefined);
  const decide = fixture.access(() => approver);
  unwrap(
    await decide.execute({
      type: "approve",
      itemId,
      requestId: "approval",
      expectedVersion: 1,
      changeId: change.id,
      fingerprint: review.fingerprint,
    }),
  );
  expect(unwrap(await edit.read(itemId)).stock).toBeNull();
  let actor = stock;
  const warehouse = fixture.access(() => actor);
  const prior = unwrap(await warehouse.read(itemId)).stock;
  assert(prior !== null);
  expect(
    prior.positions.every(({ site, canDispose }) => site === "Berlin assembly" && !canDispose),
  ).toBe(true);
  time(Date.parse(effectiveAt));
  const after = unwrap(await warehouse.read(itemId)).stock;
  const free = after?.positions.find(({ serial }) => serial === "IO-A-005");
  const reserved = after?.positions.find(({ serial }) => serial === "IO-A-006");
  assert(free?.canDispose === true && reserved !== undefined && !reserved.canDispose);
  const hold: EngineeringChangeCommand = {
    type: "disposition",
    itemId,
    changeId: change.id,
    requestId: "hold",
    positionId: free.id,
    expectedPositionVersion: free.version,
    action: "hold",
    reason: "Reserve for inspection",
  };
  expect(
    await warehouse.execute({ ...hold, positionId: reserved.id, requestId: "reserved" }),
  ).toEqual({
    ok: false,
    error: "stockUnavailable",
  });
  const held = unwrap(await warehouse.execute(hold)).stock?.positions.find(
    ({ id }) => id === free.id,
  );
  assert(held !== undefined);
  expect(held.history).toMatchObject([
    { actor: "Warehouse", action: "hold", reason: "Reserve for inspection" },
  ]);
  actor = { ...stock, dispositionSites: [] };
  expect(await warehouse.execute(hold)).toEqual({ ok: false, error: "unavailable" });
  actor = stock;
  const released = unwrap(
    await warehouse.execute({
      ...hold,
      requestId: "release",
      expectedPositionVersion: held.version,
      action: "release",
      reason: "Inspection complete",
    }),
  ).stock?.positions.find(({ id }) => id === free.id);
  expect(released?.history.map(({ action }) => action)).toEqual(["hold", "release"]);
  expect(released?.status).toBe("available");
});
