import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ListmonkClient } from "@/features/newsletter/listmonkClient";
import { defineOperation } from "@/features/newsletter/operation";
import {
  audienceId,
  audiencePageSize,
  bounce,
  canRequestOptin,
  csvDelimiter,
  importMaxBytes,
  importMode,
  importProgress,
  listOptin,
  listStatus,
  listType,
  mailingList,
  minimalList,
  newSubscriberStatus,
  subscriber,
  subscriptionStatus,
} from "./contracts";
import { projectImportLogs, validatedCsv } from "./importContent";

const empty = z.strictObject({}).default({});
const byId = z.strictObject({ id: audienceId });
const pageInput = { page: z.number().int().positive().max(10_000).default(1) };
const search = z.string().trim().max(200).default("");
const listIds = z
  .array(audienceId)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
const email = z.email().max(254);
const profile = {
  name: z.string().trim().max(200),
  attribs: z
    .string()
    .max(16_000)
    .transform((value, ctx) => {
      try {
        return z.record(z.string(), z.unknown()).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: "custom", message: "audience_invalid_attributes" });
        return z.NEVER;
      }
    }),
};
const listFields = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000),
  type: listType,
  optin: listOptin,
  status: listStatus,
  tags: z.array(z.string().trim().min(1).max(100)).max(30),
});

function pageOf<T extends z.ZodType>(schema: T) {
  return z.object({
    results: z
      .array(schema)
      .nullable()
      .transform((items) => items ?? []),
    total: z.number().int().nonnegative(),
  });
}

const listPage = pageOf(mailingList);
const subscriberPage = pageOf(subscriber);
const bouncePage = pageOf(bounce);
const minimalLists = z.union([
  z.object({ results: z.array(minimalList) }),
  z.array(minimalList).transform((results) => ({ results })),
]);

async function activeLists(client: ListmonkClient) {
  const query = new URLSearchParams({ minimal: "true", status: "active" });
  return minimalLists.parse(await client.json("GET", "/api/lists", { query })).results;
}

function paging(page: number): URLSearchParams {
  return new URLSearchParams({
    page: String(page),
    per_page: String(audiencePageSize),
    order: "desc",
    order_by: "created_at",
  });
}

function literalSubscriberSearch(value: string): string {
  // The pinned subscriber query uses PostgreSQL's case-insensitive regex match.
  return value.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
}

function checkListIds(ids: number[], current: { id: number }[]) {
  const available = new Set(current.map((list) => list.id));
  if (ids.some((id) => !available.has(id))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "audience_invalid_list" });
  }
}

export const audienceReads = {
  "lists.minimal": defineOperation(empty, async (client) => {
    return (await activeLists(client)).map(({ id, name }) => ({ id, name }));
  }),
  "lists.page": defineOperation(
    z.strictObject({
      ...pageInput,
      search,
      status: listStatus.optional(),
      type: listType.optional(),
      optin: listOptin.optional(),
    }),
    async (client, input) => {
      const query = paging(input.page);
      if (input.search !== "") query.set("query", input.search);
      if (input.status !== undefined) query.set("status", input.status);
      if (input.type !== undefined) query.set("type", input.type);
      if (input.optin !== undefined) query.set("optin", input.optin);
      return listPage.parse(await client.json<unknown>("GET", "/api/lists", { query }));
    },
  ),
  "subscribers.get": defineOperation(byId, async (client, { id }) =>
    subscriber.parse(await client.json("GET", `/api/subscribers/${id}`)),
  ),
  "subscribers.page": defineOperation(
    z.strictObject({
      ...pageInput,
      search,
      listId: audienceId.optional(),
      subscriptionStatus: subscriptionStatus.optional(),
    }),
    async (client, input) => {
      const query = paging(input.page);
      if (input.search !== "") query.set("search", literalSubscriberSearch(input.search));
      if (input.listId !== undefined) query.set("list_id", String(input.listId));
      if (input.subscriptionStatus !== undefined)
        query.set("subscription_status", input.subscriptionStatus);
      return subscriberPage.parse(await client.json<unknown>("GET", "/api/subscribers", { query }));
    },
  ),
  "subscribers.bounces": defineOperation(
    z.strictObject({ ...pageInput, source: search, campaignId: audienceId.optional() }),
    async (client, input) => {
      const query = paging(input.page);
      if (input.source !== "") query.set("source", input.source);
      if (input.campaignId !== undefined) query.set("campaign_id", String(input.campaignId));
      return bouncePage.parse(await client.json<unknown>("GET", "/api/bounces", { query }));
    },
  ),
  "subscribers.importStatus": defineOperation(empty, async (client) =>
    importProgress.parse(await client.json<unknown>("GET", "/api/import/subscribers")),
  ),
  "subscribers.importLogs": defineOperation(empty, async (client) =>
    projectImportLogs(
      z.string().parse(await client.json<unknown>("GET", "/api/import/subscribers/logs")),
    ),
  ),
};

export const audienceWrites = {
  "lists.create": defineOperation(listFields, async (client, body) =>
    mailingList.parse(await client.json<unknown>("POST", "/api/lists", { body })),
  ),
  "lists.update": defineOperation(
    listFields.extend({ id: audienceId }),
    async (client, { id, ...body }) =>
      mailingList.parse(await client.json<unknown>("PUT", `/api/lists/${id}`, { body })),
  ),
  "lists.delete": defineOperation(byId, async (client, { id }) =>
    z.boolean().parse(await client.json<unknown>("DELETE", `/api/lists/${id}`)),
  ),
  "subscribers.create": defineOperation(
    z.strictObject({ ...profile, email, status: newSubscriberStatus, lists: listIds }),
    async (client, input, context) => {
      if (input.lists.length > 0) {
        const lists = await activeLists(client);
        checkListIds(input.lists, lists);
        // A selected list can switch to double opt-in before the upstream mutation.
        if (input.status !== "blocklisted") context.requireDelivery();
      }
      return subscriber.parse(
        await client.json<unknown>("POST", "/api/subscribers", {
          body: { ...input, preconfirm_subscriptions: false },
        }),
      );
    },
  ),
  "subscribers.update": defineOperation(
    z.strictObject({ ...profile, name: profile.name.min(1), id: audienceId }),
    async (client, { id, ...input }) =>
      subscriber.parse(
        await client.json<unknown>("PATCH", `/api/subscribers/${id}`, {
          // An explicit empty status tells the SQL update to leave current suppression in place.
          // No list IDs are present, so preconfirm only suppresses the automatic notification hook.
          body: { ...input, status: "", preconfirm_subscriptions: true },
        }),
      ),
  ),
  "subscribers.assignLists": defineOperation(
    z.strictObject({ id: audienceId, lists: listIds.refine((ids) => ids.length > 0) }),
    async (client, input) => {
      const lists = await activeLists(client);
      checkListIds(input.lists, lists);
      return z.boolean().parse(
        await client.json<unknown>("PUT", `/api/subscribers/lists/${input.id}`, {
          body: { ids: [input.id], target_list_ids: input.lists, action: "add", status: "" },
        }),
      );
    },
  ),
  "subscribers.unsubscribe": defineOperation(
    z.strictObject({ id: audienceId, listId: audienceId }),
    async (client, { id, listId }) =>
      z.boolean().parse(
        await client.json<unknown>("PUT", `/api/subscribers/lists/${id}`, {
          body: { ids: [id], target_list_ids: [listId], action: "unsubscribe" },
        }),
      ),
  ),
  "subscribers.blocklist": defineOperation(byId, async (client, { id }) =>
    z.boolean().parse(await client.json<unknown>("PUT", `/api/subscribers/${id}/blocklist`)),
  ),
  "subscribers.optin": defineOperation(byId, async (client, { id }, context) => {
    context.requireDelivery();
    const current = subscriber.parse(await client.json<unknown>("GET", `/api/subscribers/${id}`));
    if (!canRequestOptin(current))
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "audience_no_pending_optin" });
    return z.boolean().parse(await client.json<unknown>("POST", `/api/subscribers/${id}/optin`));
  }),
  "subscribers.deleteBounce": defineOperation(byId, async (client, { id }) =>
    z.boolean().parse(await client.json<unknown>("DELETE", `/api/bounces/${id}`)),
  ),
  "subscribers.startImport": defineOperation(
    z.strictObject({
      name: z
        .string()
        .min(5)
        .max(120)
        .regex(/^[^/\\]+\.csv$/i)
        .refine((value) => [...value].every((character) => character.charCodeAt(0) >= 32)),
      content: z
        .string()
        .min(4)
        .max(Math.ceil(importMaxBytes / 3) * 4),
      mode: importMode,
      delimiter: csvDelimiter,
      lists: listIds,
      overwriteProfile: z.boolean(),
    }),
    async (client, input, context) => {
      const bytes = validatedCsv(input.content, input.delimiter);
      const lists = input.mode === "blocklist" ? [] : input.lists;
      if (input.mode === "subscribe") {
        if (lists.length === 0)
          throw new TRPCError({ code: "BAD_REQUEST", message: "audience_invalid_list" });
        checkListIds(lists, await activeLists(client));
      }
      context.requireDelivery(); // The importer sends an administrator completion notice.
      const body = new FormData();
      body.set(
        "params",
        JSON.stringify({
          mode: input.mode,
          delim: input.delimiter,
          subscription_status: input.mode === "blocklist" ? "unsubscribed" : "unconfirmed",
          lists,
          overwrite_userinfo: input.mode === "subscribe" && input.overwriteProfile,
          overwrite_subscription_status: false,
        }),
      );
      body.set("file", new Blob([bytes], { type: "text/csv" }), input.name);
      return importProgress.parse(await client.multipart<unknown>("/api/import/subscribers", body));
    },
  ),
  "subscribers.cancelImport": defineOperation(
    z.strictObject({ name: z.string().max(120) }),
    async (client, { name }) => {
      const current = importProgress.parse(await client.json("GET", "/api/import/subscribers"));
      if (current.status !== "importing" || current.name !== name) {
        throw new TRPCError({ code: "CONFLICT", message: "audience_import_changed" });
      }
      return importProgress.parse(await client.json("DELETE", "/api/import/subscribers"));
    },
  ),
};
