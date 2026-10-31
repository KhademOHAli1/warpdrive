import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { emailMessages, emailThreads, notes, persons } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authoritySignal } from "./authority.test-helpers";
import { listPrivacyDiscoveryPage } from "./discovery";
import { discoveryFixture } from "./discovery.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("P07A/P07B: current verified contact links produce minimal reviewed candidates, not an ownership or shared-address sweep", async () => {
  const f = await discoveryFixture(h);
  const found: { store: string; recordId: string; confidence: string; reviewRequired: boolean }[] =
    [];
  let cursor: string | undefined;
  do {
    const result = await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 3, ...(cursor === undefined ? {} : { cursor }) },
      authoritySignal(),
    );
    assert(result.ok, JSON.stringify(result));
    expect(result.value.candidates.length).toBeLessThanOrEqual(3);
    expect(result.value.complete).toBe(false);
    expect(result.value.blockers.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    found.push(...result.value.candidates);
    cursor = result.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  const key = (store: string, id: string) => `${store}:${id}`;
  const keys = found.map((item) => key(item.store, item.recordId));
  for (const [store, id] of [
    ["persons", f.subject.id],
    ["deals", f.directDeal.id],
    ["deals", f.participantDeal.id],
    ["deals", f.customDeal.id],
    ["leads", f.lead.id],
    ["activities", f.directActivity.id],
    ["activities", f.dealActivity.id],
    ["activities", f.guestActivity.id],
    ["notes", f.note.id],
    ["comments", f.comment.id],
    ["change_logs", f.history.id],
    ["files", f.file.id],
    ["email_threads", f.thread.id],
    ["email_messages", f.message.id],
    ["email_drafts", f.draft.id],
  ])
    expect(keys).toContain(key(store as string, id as string));
  for (const [store, id] of [
    ["deals", f.unrelatedDeal.id],
    ["deals", f.ambiguousDeal.id],
    ["activities", f.ownedActivity.id],
    ["email_threads", f.unrelatedThread.id],
    ["email_messages", f.unrelatedMessage.id],
  ])
    expect(keys).not.toContain(key(store as string, id as string));
  const ambiguous = found.find(
    (item) => item.store === "persons" && item.recordId === f.sharedSubject.id,
  );
  expect(ambiguous).toMatchObject({ confidence: "ambiguous", reviewRequired: true });
  expect(new Set(keys).size).toBe(keys.length);
});

test("C08: keyset pages stay at most 100 and resume a large direct content set without omissions", async () => {
  const f = await discoveryFixture(h);
  const seeded = await h.db
    .insert(notes)
    .values(
      Array.from({ length: 205 }, () => ({
        entityType: "person",
        entityId: f.subject.id,
        body: "PRIVATE-SCALE-SENTINEL",
        authorId: f.authority.user.id,
      })),
    )
    .returning({ id: notes.id });
  const found = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const result = await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 100, ...(cursor === undefined ? {} : { cursor }) },
      authoritySignal(),
    );
    assert(result.ok);
    expect(result.value.candidates.length).toBeLessThanOrEqual(100);
    for (const candidate of result.value.candidates)
      if (candidate.store === "notes") found.add(candidate.recordId);
    cursor = result.value.nextCursor ?? undefined;
    pages++;
    expect(pages).toBeLessThan(10);
  } while (cursor !== undefined);
  for (const row of seeded) expect(found.has(row.id)).toBe(true);
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 101 },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "invalid_input" });
});

test("P07A/P07B: stored contact aliases only produce ambiguous candidates and never accept caller-supplied identity links", async () => {
  const f = await discoveryFixture(h);
  await h.db
    .update(persons)
    .set({ primaryEmail: f.aliasAddress })
    .where(eq(persons.id, f.sharedSubject.id));
  const [thread] = await h.db
    .insert(emailThreads)
    .values({ accountId: f.thread.accountId, gmailThreadId: randomUUID() })
    .returning();
  assert(thread !== undefined);
  const [message] = await h.db
    .insert(emailMessages)
    .values({
      accountId: thread.accountId,
      threadId: thread.id,
      gmailMessageId: randomUUID(),
      direction: "inbound",
      fromEmail: f.aliasAddress,
      toEmails: ["third-party@example.test"],
      bodyText: "PRIVATE-ALIAS-MESSAGE-SENTINEL",
    })
    .returning();
  assert(message !== undefined);
  const result = await listPrivacyDiscoveryPage(
    h.db,
    f.authority.actor,
    { caseId: f.privacyCase.id, limit: 100 },
    authoritySignal(),
  );
  assert(result.ok, JSON.stringify(result));
  expect(result.value.candidates).toContainEqual(
    expect.objectContaining({
      store: "persons",
      recordId: f.sharedSubject.id,
      confidence: "ambiguous",
    }),
  );
  expect(result.value.candidates).toContainEqual(
    expect.objectContaining({
      store: "email_messages",
      recordId: message.id,
      confidence: "ambiguous",
      provenance: expect.objectContaining({ relation: "correspondence_only" }),
    }),
  );
  expect(
    result.value.candidates.some(
      (candidate) => candidate.store === "deals" && candidate.recordId === f.ambiguousDeal.id,
    ),
  ).toBe(false);
  expect(
    result.value.candidates.some(
      (candidate) => candidate.store === "email_threads" && candidate.recordId === thread.id,
    ),
  ).toBe(false);
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 100, reviewedAliases: ["victim@example.test"] },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "invalid_input" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
});
