import { beforeEach, expect, it, vi } from "vitest";
import type { NewsletterExecution } from "@/features/newsletter/operation";
import type { Campaign } from "../campaigns/model";
import { campaignReads, campaignWrites } from "../campaigns/operations";
import { replyRoutingAttribute } from "./contracts";
import { campaignReplyRouting, listReplyMailboxes, requireCurrentReplyRouting } from "./routing";

const mailboxes = vi.hoisted(() => ({ list: vi.fn() }));
const engine = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("@/features/email/mailAccountsRepo", () => ({ listActorMailboxes: mailboxes.list }));
vi.mock("@/features/newsletter/listmonkClient", () => ({ createListmonkClient: () => engine }));
vi.mock("@/config/env", () => ({ env: {} }));

const ownedId = "51fab8a3-0660-44a3-9bf4-0c2b36f9a40b";
const pausedId = "fbc1ba9a-09dd-4c3b-906f-3ad09b2e0531";
const address = "replies@example.test";
const context = {
  db: {},
  actor: { id: "current-actor", type: "admin" },
  signal: AbortSignal.timeout(1000),
  requireDelivery: () => undefined,
} as unknown as NewsletterExecution;

const draft = { name: "Draft", subject: "Subject", lists: [1] };
const revision = "2026-11-11T09:00:00Z";
function savedCampaign(): Campaign {
  return {
    id: 9,
    name: draft.name,
    subject: draft.subject,
    type: "regular",
    status: "draft",
    body: "",
    content_type: "html",
    from_email: "sender@example.test",
    messenger: "email",
    lists: [{ id: 1, name: "List" }],
    media: [],
    send_at: null,
    template_id: null,
    tags: [],
    headers: [{ "Reply-To": address }],
    attribs: { [replyRoutingAttribute]: { version: 1, mailboxId: ownedId } },
    archive: false,
    archive_slug: null,
    archive_template_id: null,
    archive_meta: {},
    sent: 0,
    to_send: 0,
    views: 0,
    clicks: 0,
    bounces: 0,
    updated_at: revision,
  };
}

beforeEach(() => {
  engine.json.mockReset();
  mailboxes.list.mockReset().mockResolvedValue([
    {
      id: ownedId,
      provider: "gmail",
      status: "connected",
      emailAddress: address,
      capabilities: { read: true },
    },
    {
      id: pausedId,
      provider: "gmail",
      status: "paused",
      emailAddress: "paused@example.test",
      capabilities: { read: true },
    },
    {
      id: "send-only",
      provider: "gmail",
      status: "connected",
      emailAddress: "send-only@example.test",
      capabilities: { read: false },
    },
  ]);
});

it("projects only the current actor's active inbox and preserves manual headers", async () => {
  expect(await campaignReads["campaigns.replyMailboxes"].run({}, context)).toEqual([
    { id: ownedId, address },
  ]);
  expect(mailboxes.list).toHaveBeenCalledWith(context.db, context.actor.id, context.signal);
  expect(engine.json).not.toHaveBeenCalled();
  mailboxes.list.mockClear();
  const manual = {
    headers: [{ "reply-to": "Operator <manual@example.test>" }],
    attribs: { site: "newsletter" },
  };
  expect(await campaignReplyRouting(context, manual)).toEqual(manual);
  expect(mailboxes.list).not.toHaveBeenCalled();
});

it("requires an IMAP Inbox selected for inbound sync", async () => {
  const imap = {
    id: ownedId,
    provider: "imap_smtp",
    status: "connected",
    emailAddress: address,
    capabilities: { read: true },
  };
  mailboxes.list.mockResolvedValueOnce([{ ...imap, folderPaths: ["Sent"] }]);
  expect(await listReplyMailboxes(context)).toEqual([]);
  mailboxes.list.mockResolvedValueOnce([{ ...imap, folderPaths: ["Inbox", "Sent"] }]);
  expect(await listReplyMailboxes(context)).toEqual([{ id: ownedId, address }]);
});

it("stores one canonical header and refuses mismatched or unavailable routes", async () => {
  const selected = await campaignReplyRouting(context, {
    replyToMailboxId: ownedId,
    headers: [{ "X-Project": "Campaign" }, { "reply-to": address }],
    attribs: { site: "newsletter" },
  });
  expect(selected).toEqual({
    headers: [{ "X-Project": "Campaign" }, { "Reply-To": address }],
    attribs: { site: "newsletter", [replyRoutingAttribute]: { version: 1, mailboxId: ownedId } },
  });
  await expect(
    campaignReplyRouting(context, {
      replyToMailboxId: ownedId,
      headers: [{ "Reply-To": "different@example.test" }],
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    campaignReplyRouting(context, {
      replyToMailboxId: pausedId,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(requireCurrentReplyRouting(context, selected)).resolves.toBeUndefined();
  await expect(
    requireCurrentReplyRouting(context, {
      ...selected,
      headers: [{ "Reply-To": address }, { "reply-to": address }],
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  mailboxes.list.mockResolvedValue([]);
  await expect(requireCurrentReplyRouting(context, selected)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
});

it("rejects forged metadata and removes the managed header when explicitly cleared", async () => {
  const attribs = { [replyRoutingAttribute]: { version: 1, mailboxId: ownedId } };
  await expect(campaignReplyRouting(context, { attribs })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  const previous: Pick<Campaign, "attribs" | "headers"> = {
    attribs,
    headers: [{ "Reply-To": address }, { "X-Project": "Campaign" }],
  };
  expect(await campaignReplyRouting(context, { replyToMailboxId: null }, previous)).toEqual({
    attribs: {},
    headers: [{ "X-Project": "Campaign" }],
  });
});

it("persists managed identity and the exact header through the campaign create command", async () => {
  engine.json.mockResolvedValueOnce({ id: 9 });
  await expect(
    campaignWrites["campaigns.create"].run({ ...draft, replyToMailboxId: ownedId }, context),
  ).resolves.toEqual({ id: 9 });
  expect(engine.json).toHaveBeenCalledWith("POST", "/api/campaigns", {
    body: {
      ...draft,
      type: "regular",
      headers: [{ "Reply-To": address }],
      attribs: { [replyRoutingAttribute]: { version: 1, mailboxId: ownedId } },
    },
  });
});

it("rejects a changed mailbox on save or launch before a campaign mutation", async () => {
  const saved = savedCampaign();
  engine.json.mockResolvedValue(saved);
  mailboxes.list.mockResolvedValue([
    {
      id: ownedId,
      provider: "gmail",
      status: "connected",
      emailAddress: "new-address@example.test",
      capabilities: { read: true },
    },
  ]);
  await expect(
    campaignWrites["campaigns.update"].run(
      {
        ...draft,
        id: saved.id,
        expectedUpdatedAt: revision,
        replyToMailboxId: ownedId,
        headers: saved.headers,
      },
      context,
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  for (const status of ["running", "scheduled"]) {
    engine.json.mockResolvedValueOnce({
      ...saved,
      send_at: status === "scheduled" ? new Date(Date.now() + 60_000).toISOString() : null,
    });
    await expect(
      campaignWrites["campaigns.status"].run(
        { id: saved.id, status, confirmed: true, expectedUpdatedAt: revision },
        context,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }
  expect(engine.json.mock.calls).toEqual(
    Array.from({ length: 3 }, () => ["GET", "/api/campaigns/9"]),
  );
});

it("switches a managed draft to an explicit manual Reply-To", async () => {
  const saved = savedCampaign();
  const headers = [{ "Reply-To": "Operator <manual@example.test>" }];
  engine.json
    .mockResolvedValueOnce(saved)
    .mockResolvedValueOnce({ ...saved, headers, attribs: {} });
  await expect(
    campaignWrites["campaigns.update"].run(
      { ...draft, id: saved.id, expectedUpdatedAt: revision, replyToMailboxId: null, headers },
      context,
    ),
  ).resolves.toMatchObject({ headers, attribs: {} });
  expect(mailboxes.list).not.toHaveBeenCalled();
  expect(engine.json).toHaveBeenNthCalledWith(
    2,
    "PUT",
    "/api/campaigns/9",
    expect.objectContaining({ body: expect.objectContaining({ headers, attribs: {} }) }),
  );
});

it("can pause a running campaign after its reply mailbox becomes unavailable", async () => {
  const running = { ...savedCampaign(), status: "running" };
  const paused = { ...running, status: "paused" };
  engine.json.mockResolvedValueOnce(running).mockResolvedValueOnce(paused);
  mailboxes.list.mockResolvedValue([]);
  await expect(
    campaignWrites["campaigns.status"].run({ id: 9, status: "paused", confirmed: true }, context),
  ).resolves.toMatchObject({ status: "paused" });
  expect(mailboxes.list).not.toHaveBeenCalled();
  expect(engine.json).toHaveBeenNthCalledWith(2, "PUT", "/api/campaigns/9/status", {
    body: { status: "paused" },
  });
});
