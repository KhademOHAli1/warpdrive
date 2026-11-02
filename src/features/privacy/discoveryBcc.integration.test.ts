import assert from "node:assert/strict";
import { afterAll, beforeAll, expect, test } from "vitest";
import { emailDrafts } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { listPrivacyDiscoveryPage } from "./discovery";
import { discoveryFixture } from "./discovery.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function draftsFor(f: Awaited<ReturnType<typeof discoveryFixture>>) {
  const base = {
    accountId: f.draft.accountId,
    toEmails: [] as string[],
    ccEmails: [] as string[],
    bccEmails: [] as string[],
    subject: "PRIVATE-BCC-SUBJECT-SENTINEL",
    bodyHtml: "PRIVATE-BCC-CONTENT-SENTINEL",
  };
  const [bcc, to, cc, unrelated] = await h.db
    .insert(emailDrafts)
    .values([
      { ...base, bccEmails: [`  ${f.aliasAddress.toUpperCase()}  `] },
      { ...base, toEmails: [f.aliasAddress] },
      { ...base, ccEmails: [f.subject.primaryEmail] },
      { ...base, bccEmails: [f.unrelatedSubject.primaryEmail] },
    ])
    .returning({ id: emailDrafts.id });
  assert(bcc !== undefined && to !== undefined && cc !== undefined && unrelated !== undefined);
  return { bcc, to, cc, unrelated };
}

async function discover(f: Awaited<ReturnType<typeof discoveryFixture>>) {
  return listPrivacyDiscoveryPage(
    h.db,
    f.authority.actor,
    { caseId: f.privacyCase.id, limit: 100 },
    authoritySignal(),
  );
}

test("a reviewed contact's BCC-only draft is a minimal ambiguous candidate, never disclosed content", async () => {
  const f = await discoveryFixture(h);
  const drafts = await draftsFor(f);
  const result = await discover(f);
  assert(result.ok, JSON.stringify(result));
  const candidate = result.value.candidates.find(
    (item) => item.store === "email_drafts" && item.recordId === drafts.bcc.id,
  );
  expect(candidate).toEqual({
    store: "email_drafts",
    recordId: drafts.bcc.id,
    confidence: "ambiguous",
    reviewRequired: true,
    provenance: {
      relation: "draft_context_or_correspondence",
      source: expect.stringContaining("bcc_emails"),
    },
  });
  expect(result.value.complete).toBe(false);
  expect(result.value.blockers).toContainEqual(
    expect.objectContaining({ store: "reviewed_scope", status: "review_required" }),
  );
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("PRIVATE-BCC");
  expect(serialized).not.toContain(f.aliasAddress);
  expect(serialized).not.toContain(f.subject.primaryEmail);
});

test("BCC matching keeps To/Cc candidates and excludes an unrelated BCC-only draft", async () => {
  const f = await discoveryFixture(h);
  const drafts = await draftsFor(f);
  const result = await discover(f);
  assert(result.ok, JSON.stringify(result));
  const ids = result.value.candidates
    .filter((candidate) => candidate.store === "email_drafts")
    .map((candidate) => candidate.recordId);
  expect(ids).toContain(drafts.to.id);
  expect(ids).toContain(drafts.cc.id);
  expect(ids).not.toContain(drafts.unrelated.id);
  expect(JSON.stringify(result)).not.toContain("PRIVATE-BCC");
});

test("BCC correspondence does not grant another current reviewer access to this case", async () => {
  const f = await discoveryFixture(h);
  await draftsFor(f);
  const other = await authorityFixture(h, ["case.review", "case.disclose"]);
  const result = await listPrivacyDiscoveryPage(
    h.db,
    other.actor,
    { caseId: f.privacyCase.id, limit: 100 },
    authoritySignal(),
  );
  expect(result).toEqual({ ok: false, error: "forbidden" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-BCC");
  expect(JSON.stringify(result)).not.toContain(f.aliasAddress);
});
