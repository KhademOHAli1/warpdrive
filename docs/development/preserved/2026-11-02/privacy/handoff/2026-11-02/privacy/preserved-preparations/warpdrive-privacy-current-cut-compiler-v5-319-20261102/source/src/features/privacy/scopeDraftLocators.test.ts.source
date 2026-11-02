import { describe, expect, it } from "vitest";
import { buildScopeDraftPlan } from "./scopeDraft";
import { draftDigest, draftId, scopeDraftFixture } from "./scopeDraftTestKit";

const signal = () => AbortSignal.timeout(5000);
function withLocator(store: string, locator: unknown) {
  const f = scopeDraftFixture();
  const category = f.input.categories[0];
  const expected = f.context.categories[0];
  const record = category?.records[0];
  const source = expected?.records[0];
  if (category !== undefined) category.store = store;
  if (expected !== undefined) expected.store = store;
  if (record !== undefined) {
    Reflect.set(record, "locator", locator);
    record.decisions = record.decisions.slice(0, 1);
    const field = record.decisions[0];
    if (field !== undefined) field.field = "id";
  }
  if (source !== undefined) {
    Reflect.set(source, "locator", structuredClone(locator));
    source.fields = ["id"];
  }
  return f;
}

describe("strict native record locators", () => {
  it.each([
    [
      "email_messages",
      { kind: "mailbox", store: "email_messages", id: draftId(30), accountId: draftId(31) },
    ],
    [
      "email_threads",
      { kind: "mailbox", store: "email_threads", id: draftId(30), accountId: draftId(31) },
    ],
    [
      "email_drafts",
      { kind: "mailbox", store: "email_drafts", id: draftId(30), accountId: draftId(31) },
    ],
  ])("preserves %s mailbox identity separately from recordRef", (store, locator) => {
    const f = withLocator(store, locator);
    const result = buildScopeDraftPlan(f.input, f.context, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.canonicalJson).toContain(draftId(31));
    expect(result.value.canonicalJson).toContain(draftId(5));
  });

  it.each([
    [
      "activity_guests",
      {
        kind: "activity_guest",
        store: "activity_guests",
        activityId: draftId(30),
        personId: draftId(31),
      },
      "personId",
    ],
    [
      "activity_participants",
      {
        kind: "activity_participant",
        store: "activity_participants",
        activityId: draftId(30),
        userId: draftId(31),
      },
      "userId",
    ],
    [
      "deal_participants",
      {
        kind: "deal_participant",
        store: "deal_participants",
        dealId: draftId(30),
        personId: draftId(31),
      },
      "personId",
    ],
  ])("uses actual %s association keys", (store, locator, fieldName) => {
    const f = withLocator(store, locator);
    const record = f.input.categories[0]?.records[0];
    const source = f.context.categories[0]?.records[0];
    if (record !== undefined) {
      const field = record.decisions[0];
      if (field !== undefined) field.field = fieldName;
    }
    if (source !== undefined) source.fields = [fieldName];
    expect(buildScopeDraftPlan(f.input, f.context, signal()).ok).toBe(true);
  });

  it("rejects missing mailbox context and invented composite UUID strings", () => {
    const f = withLocator("email_messages", {
      kind: "mailbox",
      store: "email_messages",
      id: draftId(30),
    });
    expect(buildScopeDraftPlan(f.input, f.context, signal()).ok).toBe(false);
    const g = withLocator("activity_guests", {
      kind: "uuid",
      store: "activity_guests",
      id: `${draftId(30)}:${draftId(31)}`,
    });
    expect(buildScopeDraftPlan(g.input, g.context, signal()).ok).toBe(false);
  });

  it("rejects repeated recordRefs and normalized native keys", () => {
    const f = scopeDraftFixture();
    const category = f.input.categories[0];
    const expected = f.context.categories[0];
    const record = category?.records[0];
    const source = expected?.records[0];
    if (
      category === undefined ||
      expected === undefined ||
      record === undefined ||
      source === undefined
    )
      return;
    category.records = [...category.records, structuredClone(record)];
    expected.records = [...expected.records, structuredClone(source)];
    expect(buildScopeDraftPlan(f.input, f.context, signal())).toEqual({
      ok: false,
      error: "scope_duplicate",
    });
    const secondRecord = category.records[1];
    const secondSource = expected.records[1];
    if (secondRecord === undefined || secondSource === undefined) return;
    secondRecord.recordRef = draftId(40);
    secondSource.recordRef = draftId(40);
    expect(buildScopeDraftPlan(f.input, f.context, signal())).toEqual({
      ok: false,
      error: "scope_duplicate",
    });
  });

  it("does not conflate equal UUIDs in users and auth_users", () => {
    const f = withLocator("auth_users", { kind: "uuid", store: "auth_users", id: draftId(3) });
    const category = f.input.categories[0];
    const expected = f.context.categories[0];
    const record = category?.records[0];
    const source = expected?.records[0];
    if (record === undefined || source === undefined) return;
    const user = {
      ...structuredClone(record),
      recordRef: draftId(41),
      locator: { kind: "uuid", store: "users", id: draftId(3) },
      sourceFingerprint: draftDigest("1"),
    };
    const userCategory = f.input.categories[1];
    const userCoverage = f.context.categories[1];
    if (userCategory === undefined || userCoverage === undefined) return;
    userCategory.records = [user];
    userCoverage.records = [
      {
        recordRef: user.recordRef,
        locator: structuredClone(user.locator),
        sourceFingerprint: user.sourceFingerprint,
        provenance: structuredClone(user.provenance),
        fields: ["id"],
      },
    ];
    expect(buildScopeDraftPlan(f.input, f.context, signal()).ok).toBe(true);
  });
});
