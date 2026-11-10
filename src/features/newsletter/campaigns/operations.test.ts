import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsletterExecution } from "@/features/newsletter/operation";
import type { Campaign } from "./model";
import { campaignWrites } from "./operations";

const engine = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: { NEWSLETTER_TEST_RECIPIENTS: ["tester+capture@example.test"] },
}));
vi.mock("@/features/newsletter/listmonkClient", () => ({
  createListmonkClient: () => engine,
}));

const context = {
  signal: AbortSignal.timeout(1_000),
  requireDelivery: () => undefined,
} as NewsletterExecution;

function row(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 9,
    name: "Existing campaign",
    subject: "Subject",
    type: "regular",
    status: "paused",
    body: "",
    content_type: "html",
    from_email: "sender@example.test",
    messenger: "email",
    lists: [{ id: 1, name: "Original list" }],
    media: [],
    send_at: null,
    started_at: "2026-11-10T20:00:00Z",
    template_id: null,
    tags: [],
    headers: [],
    attribs: {},
    archive: false,
    archive_slug: null,
    archive_template_id: null,
    archive_meta: {},
    sent: 1,
    to_send: 1,
    views: 0,
    clicks: 0,
    bounces: 0,
    updated_at: "2026-11-10T20:00:00Z",
    ...overrides,
  };
}

beforeEach(() => engine.json.mockReset());

describe("campaign dispatch protections", () => {
  it("rejects alternate test recipients before querying or dispatching", async () => {
    await expect(
      campaignWrites["campaigns.test"].run(
        { id: 9, confirmed: true, subscribers: ["tester@example.test"] },
        context,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(engine.json).not.toHaveBeenCalled();
  });

  it("accepts only the exact approved enabled test address", async () => {
    engine.json
      .mockResolvedValueOnce(row({ status: "draft", started_at: null, sent: 0 }))
      .mockResolvedValueOnce({
        results: [{ email: "tester+capture@example.test", status: "enabled" }],
        total: 1,
        page: 1,
        per_page: 25,
      })
      .mockResolvedValueOnce(true);
    await expect(
      campaignWrites["campaigns.test"].run(
        { id: 9, confirmed: true, subscribers: ["Tester+capture@example.test"] },
        context,
      ),
    ).resolves.toBe(true);
    expect(engine.json).toHaveBeenNthCalledWith(2, "GET", "/api/subscribers", {
      query: new URLSearchParams({ search: "^tester\\+capture@example\\.test$", per_page: "25" }),
    });
    expect(engine.json).toHaveBeenNthCalledWith(
      3,
      "POST",
      "/api/campaigns/9/test",
      expect.objectContaining({
        body: expect.objectContaining({ subscribers: ["tester+capture@example.test"] }),
      }),
    );
  });

  it("keeps original unsubscribe context for campaigns that have started", async () => {
    engine.json.mockResolvedValue(row());
    await expect(
      campaignWrites["campaigns.update"].run(
        {
          id: 9,
          name: "Draft",
          subject: "Subject",
          lists: [2],
          expectedUpdatedAt: row().updated_at,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      campaignWrites["campaigns.delete"].run({ id: 9, confirmed: true }, context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(engine.json.mock.calls.map(([method]) => method)).toEqual(["GET", "GET"]);
  });

  it("requires a reviewed revision for content saves and delivery starts", async () => {
    await expect(
      campaignWrites["campaigns.update"].run(
        { id: 9, name: "Draft", subject: "Subject", lists: [1] },
        context,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      campaignWrites["campaigns.status"].run(
        { id: 9, status: "running", confirmed: true },
        context,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(engine.json).not.toHaveBeenCalled();
  });

  it("passes the exact reviewed revision to the engine for saves and delivery starts", async () => {
    const reviewed = row({ updated_at: "2026-11-10T20:00:00.123456Z" });
    engine.json
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce({ ...reviewed, status: "running" });
    await campaignWrites["campaigns.update"].run(
      {
        id: 9,
        name: "Draft",
        subject: "Subject",
        lists: [1],
        expectedUpdatedAt: reviewed.updated_at,
      },
      context,
    );
    await campaignWrites["campaigns.status"].run(
      { id: 9, status: "running", confirmed: true, expectedUpdatedAt: reviewed.updated_at },
      context,
    );
    expect(engine.json).toHaveBeenNthCalledWith(
      2,
      "PUT",
      "/api/campaigns/9",
      expect.objectContaining({
        body: expect.objectContaining({ expected_updated_at: reviewed.updated_at }),
      }),
    );
    expect(engine.json).toHaveBeenNthCalledWith(4, "PUT", "/api/campaigns/9/status", {
      body: { status: "running", expected_updated_at: reviewed.updated_at },
    });
  });

  it("allows a current emergency pause without a delivery revision", async () => {
    engine.json
      .mockResolvedValueOnce(row({ status: "running" }))
      .mockResolvedValueOnce(row({ status: "paused" }));
    await campaignWrites["campaigns.status"].run(
      { id: 9, status: "paused", confirmed: true },
      context,
    );
    expect(engine.json).toHaveBeenNthCalledWith(2, "PUT", "/api/campaigns/9/status", {
      body: { status: "paused" },
    });
  });

  it("rejects recipient headers that could bypass campaign eligibility", async () => {
    await expect(
      campaignWrites["campaigns.create"].run(
        {
          name: "Draft",
          subject: "Subject",
          lists: [1],
          headers: [{ bCC: "elsewhere@example.test" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(engine.json).not.toHaveBeenCalled();
  });
});
