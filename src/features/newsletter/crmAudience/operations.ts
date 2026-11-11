import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { campaign } from "../campaigns/model";
import type { PersonNewsletterGrant } from "../identity/contracts";
import { readPersonNewsletterGrants } from "../identity/service";
import type { ListmonkClient } from "../listmonkClient";
import { defineLocalOperation, defineOperation, type NewsletterExecution } from "../operation";
import { audienceApprovalPattern, signAudienceApproval, verifyAudienceApproval } from "./approval";
import { type AudiencePreview, sealedAudience } from "./contracts";
import { listAudienceViews, maxAudiencePeople, readAudiencePeople } from "./peopleSource";

const engineId = z.number().int().positive().max(2_147_483_647);
const byCampaign = z.strictObject({ campaignId: engineId });
const audienceInput = byCampaign.extend({ viewId: z.uuid(), listId: engineId });

function oneGrantPerMailbox(grants: PersonNewsletterGrant[], listId: number) {
  const counts = new Map<string, number>();
  for (const grant of grants) {
    counts.set(grant.subscriberUuid, (counts.get(grant.subscriberUuid) ?? 0) + 1);
  }
  return grants
    .filter((grant) => counts.get(grant.subscriberUuid) === 1 && grant.purposeListId === listId)
    .sort((left, right) => left.subscriberUuid.localeCompare(right.subscriberUuid));
}

async function currentAudience(
  client: ListmonkClient,
  input: z.infer<typeof audienceInput>,
  context: NewsletterExecution,
) {
  const [draft, selection] = await Promise.all([
    client.json("GET", `/api/campaigns/${input.campaignId}`).then((data) => campaign.parse(data)),
    readAudiencePeople(context.db, context.actor, input.viewId, context.signal),
  ]);
  if (draft.type !== "regular" || draft.status !== "draft" || draft.started_at != null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Open an unsent campaign draft." });
  }
  const personIds = selection.people
    .filter((person) => person.hasAddress)
    .map((person) => person.id);
  const grants = oneGrantPerMailbox(
    await readPersonNewsletterGrants(
      context.db,
      context.actor,
      personIds,
      input.listId,
      context.signal,
    ),
    input.listId,
  );
  if (grants.length > maxAudiencePeople) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Narrow this People view to 1,000 or fewer eligible addresses.",
    });
  }
  const eligible = new Set(grants.map((grant) => grant.personId));
  const rows: AudiencePreview["rows"] = selection.people.map(({ id, name, hasAddress }) => ({
    id,
    name,
    status: eligible.has(id) ? "eligible" : hasAddress ? "noCurrentConsent" : "missingAddress",
  }));
  const scope = [
    context.actor.id,
    input.campaignId,
    draft.updated_at,
    selection.viewId,
    selection.revision,
    selection.definition,
    input.listId,
    grants.map((grant) => [
      grant.personId,
      grant.bindingUuid,
      grant.subscriberUuid,
      grant.grantUuid,
      grant.email,
    ]),
    rows.map(({ id, status }) => [id, status]),
  ];
  return { rows, grants, eligiblePeople: eligible.size, scope, revision: draft.updated_at };
}

export const crmAudienceReads = {
  "crmAudience.views": defineLocalOperation(z.strictObject({}), (_input, { db, actor }) =>
    listAudienceViews(db, actor),
  ),
  "crmAudience.purposes": defineOperation(z.strictObject({}), async (client) => {
    const item = z.object({
      id: engineId,
      name: z.string(),
      optin: z.enum(["single", "double"]),
      status: z.enum(["active", "archived"]),
    });
    const shape = z.union([z.array(item), z.object({ results: z.array(item) })]);
    const query = new URLSearchParams({ minimal: "true", status: "active" });
    const response = shape.parse(await client.json("GET", "/api/lists", { query }));
    const rows = Array.isArray(response) ? response : response.results;
    return rows
      .filter((row) => row.optin === "double" && row.status === "active")
      .map(({ id, name }) => ({ id, name }));
  }),
  "crmAudience.seal": defineOperation(byCampaign, async (client, { campaignId }) =>
    sealedAudience.parse(await client.json("GET", `/api/warpdrive/audiences/${campaignId}`)),
  ),
  "crmAudience.preview": defineOperation(audienceInput, async (client, input, context) => {
    const audience = await currentAudience(client, input, context);
    return {
      approval:
        audience.grants.length === 0 ? null : signAudienceApproval(audience.scope, Date.now()),
      rows: audience.rows,
      eligiblePeople: audience.eligiblePeople,
      recipients: audience.grants.length,
    } satisfies AudiencePreview;
  }),
};

export const crmAudienceWrites = {
  "crmAudience.freeze": defineOperation(
    audienceInput.extend({ approval: z.string().regex(audienceApprovalPattern) }),
    async (client, { approval, ...input }, context) => {
      const audience = await currentAudience(client, input, context);
      if (
        context.operationId === undefined ||
        audience.grants.length === 0 ||
        !verifyAudienceApproval(approval, audience.scope, Date.now())
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The reviewed audience changed or expired. Refresh the preview.",
        });
      }
      return sealedAudience.parse(
        await client.json("PUT", `/api/warpdrive/audiences/${input.campaignId}`, {
          body: {
            manifest_uuid: context.operationId,
            purpose_list_id: input.listId,
            scope_digest: approval.slice(14),
            expected_updated_at: audience.revision,
            members: audience.grants.map((grant) => ({
              subscriber_uuid: grant.subscriberUuid,
              grant_uuid: grant.grantUuid,
            })),
          },
        }),
      );
    },
  ),
};
