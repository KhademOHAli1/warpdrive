import { afterEach, expect, test, vi } from "vitest";
import type { env as runtimeEnv } from "@/config/env";
import type { Db } from "@/db/client";
import type { NewsletterExecution } from "@/features/newsletter/operation";
import { audienceReads, audienceWrites } from "./operations";
import { safePublicOrigin } from "./signupEmbed";
import { projectSubscriberActivity, projectSubscriberExport } from "./subscriberRecords";

vi.mock("@/config/env", async (original) => {
  const loaded = await original<{ env: typeof runtimeEnv }>();
  return {
    ...loaded,
    env: {
      ...loaded.env,
      NEWSLETTER_BASE_URL: "http://newsletter-fixture:9000",
      NEWSLETTER_API_USER: "synthetic-engine",
      NEWSLETTER_API_TOKEN: "synthetic-test-token",
      NEWSLETTER_PUBLIC_SIGNUP_ENABLED: true,
      NEWSLETTER_PUBLIC_ORIGIN: "https://newsletter.example.test",
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

const caps = {
  consent: 2,
  dispatch: 1,
  listConsentMode: 1,
  publicSubscriberUpdate: 1,
  campaignRevision: 1,
  crmIdentity: 1,
  crmAudiences: 1,
  durableDelivery: 1,
  crmAttribution: 1,
  listEmbed: 1,
  sesFeedback: 1,
  readiness: 1,
  atomicBulk: 1,
  consentEvents: 1,
};
const uuid = "a21453b2-6289-4a40-949b-2d2b7a53a176";
const date = "2026-10-06T17:28:00Z";
const row = {
  id: 7,
  uuid,
  name: "Synthetic subscriber",
  email: "reader@example.test",
  status: "blocklisted" as const,
  updated_at: date,
  lists: [],
};
const profile = { ...row, attribs: { private: "private attribute" } };
const click = {
  link_id: 51,
  campaign_id: 21,
  campaign_name: "Fixture",
  url: "https://example.test/private-token",
  click_count: 2,
  last_clicked_at: date,
};
const ctx = (
  type: "admin" | "regular" = "admin",
  id = "first-actor",
  deliveryEnabled = true,
): NewsletterExecution => ({
  db: {} as Db,
  actor: {
    id,
    type,
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
    name: "Operator",
    email: "actor@example.test",
    avatarUrl: null,
  },
  signal: new AbortController().signal,
  configured: true,
  deliveryEnabled,
  requireDelivery: () => undefined,
});
const reply = (data: unknown) => Response.json({ data });

function engine(handler: (url: URL, init: RequestInit) => Response) {
  const fetch = vi.fn((url: URL, init: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("subscriber records use a current actor-bound proof without disclosing the upstream bearer", async () => {
  let current = row;
  const fetch = engine((url) => {
    if (url.pathname === "/api/subscribers") return reply({ results: [row], total: 1 });
    if (url.pathname === "/api/subscribers/7") return reply(current);
    return reply({ campaign_views: [], link_clicks: [click] });
  });
  const page = (await audienceReads["subscribers.page"].run({}, ctx())) as {
    results: Array<{ recordProof: string }>;
  };
  const proof = { id: 7, status: row.status, recordProof: page.results[0]?.recordProof };
  expect(JSON.stringify(page)).not.toContain(uuid);
  expect(proof.recordProof).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  await expect(
    audienceReads["subscribers.activity"].run(proof, ctx("regular")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(
    audienceReads["subscribers.activity"].run(proof, ctx("admin", "other-actor")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(audienceReads["subscribers.activity"].run(proof, ctx())).resolves.toMatchObject({
    items: [{ kind: "click", count: 2 }],
  });
  current = { ...row, email: "different@example.test" };
  await expect(audienceReads["subscribers.activity"].run(proof, ctx())).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

test("activity and selected export project bounded fields without link URLs, attributes or proof", () => {
  const activity = projectSubscriberActivity({
    campaign_views: [],
    link_clicks: Array.from({ length: 115 }, (_, i) => ({ ...click, link_id: i + 1 })),
  });
  expect(activity.items).toHaveLength(100);
  expect(activity.truncated).toBe(true);
  expect(JSON.stringify(activity)).not.toContain(click.url);
  const exported = projectSubscriberExport(
    {
      profile: [profile],
      subscriptions: [
        {
          name: "Private list",
          type: "private",
          subscription_status: "unsubscribed",
          created_at: date,
          meta: { optin_ip: "127.0.0.1" },
        },
      ],
      link_clicks: [{ url: click.url, clicks: 1 }],
    },
    row,
    ["memberships", "activity"],
  );
  expect(exported.profile).toBeUndefined();
  expect(exported.memberships?.items[0]).toEqual({
    name: "Private list",
    type: "private",
    subscription_status: "unsubscribed",
    created_at: date,
  });
  expect(exported.linkClicks?.items).toEqual([{ clicks: 1 }]);
  expect(JSON.stringify(exported)).not.toMatch(
    /optin_ip|private-token|private attribute|reader@example/,
  );
  expect(() =>
    projectSubscriberExport({ profile: [{ ...profile, status: "enabled" }] }, row, ["profile"]),
  ).toThrow("audience_subscriber_changed");
});

test("bulk commands send only normalized selected IDs and exact unsubscribe scope", async () => {
  const fetch = engine((url) =>
    url.pathname === "/api/warpdrive-capabilities" ? reply(caps) : reply(true),
  );
  await expect(
    audienceWrites["subscribers.bulkBlocklist"].run({ ids: [7, 3, 7], confirmed: true }, ctx()),
  ).resolves.toBe(true);
  await expect(
    audienceWrites["subscribers.bulkUnsubscribe"].run(
      { ids: [8, 6], confirmed: true, listId: 3 },
      ctx(),
    ),
  ).resolves.toBe(true);
  expect(
    fetch.mock.calls
      .filter(([, init]) => init.method === "PUT")
      .map(([url, init]) => [url.pathname, init.body]),
  ).toEqual([
    ["/api/subscribers/blocklist", '{"ids":[3,7]}'],
    ["/api/subscribers/lists", '{"ids":[6,8],"target_list_ids":[3],"action":"unsubscribe"}'],
  ]);
  await expect(
    audienceWrites["subscribers.bulkBlocklist"].run(
      { ids: [7], confirmed: true, query: "TRUE" },
      ctx(),
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("embed requires the exact configured HTTPS origin, engine capability and public list gates", async () => {
  let rootUrl = "https://newsletter.example.test";
  let listType = "public";
  let captcha = true;
  const fetch = engine((url) => {
    if (url.pathname === "/api/warpdrive-capabilities") return reply(caps);
    if (url.pathname === "/api/config")
      return reply({
        root_url: rootUrl,
        public_subscription: { enabled: true, captcha_enabled: captcha },
      });
    return reply({ id: 7, uuid, type: listType, status: "active" });
  });
  await expect(
    audienceReads["lists.signupEmbed"].run({ id: 7 }, ctx("admin", "actor", false)),
  ).resolves.toEqual({ status: "signupDisabled" });
  expect(fetch).not.toHaveBeenCalled();
  await expect(audienceReads["lists.signupEmbed"].run({ id: 7 }, ctx())).resolves.toMatchObject({
    status: "ready",
    url: `https://newsletter.example.test/subscription/form?l=${uuid}`,
  });
  rootUrl = "https://different.example.test";
  await expect(audienceReads["lists.signupEmbed"].run({ id: 7 }, ctx())).resolves.toEqual({
    status: "originMismatch",
  });
  rootUrl = "https://newsletter.example.test";
  listType = "private";
  await expect(audienceReads["lists.signupEmbed"].run({ id: 7 }, ctx())).resolves.toEqual({
    status: "listUnavailable",
  });
  listType = "public";
  captcha = false;
  await expect(audienceReads["lists.signupEmbed"].run({ id: 7 }, ctx())).resolves.toEqual({
    status: "verificationRequired",
  });
  expect(safePublicOrigin("https://actor:secret@newsletter.example.test")).toBeNull();
  expect(safePublicOrigin("http://newsletter.example.test")).toBeNull();
});
