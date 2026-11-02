import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals, emailAccounts, emailDrafts, persons, visibilityGroups } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { canSeeLinkedDeal, canSeeLinkedPerson } from "@/features/email/emailVisibility";
import { buildAppContext, toAuthUser } from "@/features/mcp/actorContext";
import { hydrateActor } from "@/server/hydrateActor";
import { registerWriteTools } from "./writes";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = (): AbortSignal => AbortSignal.timeout(5_000);

function required<T>(row: T | undefined): T {
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "draft-link fixture missing");
  return row;
}

async function setup(db: TestDb) {
  const user = await seedUser(db, { isAdmin: false, isActive: true, invitedAt: null });
  const other = await seedUser(db, { isAdmin: false });
  const account = required(
    (
      await db
        .insert(emailAccounts)
        .values({ userId: user.id, emailAddress: user.email, status: "connected", paused: false })
        .returning({ id: emailAccounts.id })
    )[0],
  );
  const actor = await hydrateActor(db, user.id, signal());
  if (actor === null) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "draft-link actor missing");
  expect(actor.type).toBe("regular");
  expect(actor.isActive).toBe(true);
  expect([...actor.groupIds]).toEqual([]);
  expect([...(actor.managedUserIds ?? [])]).toEqual([]);
  const server = new McpServer({ name: "draft-link-visibility-test", version: "1.0.0" });
  const tools = registerWriteTools(server, () => buildAppContext(db, actor), db);
  return { user, other, account, actor: toAuthUser(actor), tools };
}

async function seedLinks(
  db: TestDb,
  ownerId: string,
  options: {
    visibility?: "owner" | "all";
    visibleToUserIds?: string[];
    deleted?: "deal" | "person";
    archivedPipeline?: boolean;
    restrictedPipeline?: boolean;
  } = {},
) {
  const group =
    options.restrictedPipeline === true
      ? required(
          (
            await db.insert(visibilityGroups).values({ name: "Restricted pipeline" }).returning()
          )[0],
        )
      : null;
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"], {
    isArchived: options.archivedPipeline ?? false,
    visibilityGroupId: group?.id ?? null,
  });
  const stage = required(stages[0]);
  const deal = required(
    (
      await db
        .insert(deals)
        .values({
          title: "Linked deal",
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerId,
          visibilityLevel: options.visibility ?? "owner",
          visibleToUserIds: options.visibleToUserIds ?? [],
          deletedAt: options.deleted === "deal" ? new Date() : null,
        })
        .returning({ id: deals.id })
    )[0],
  );
  const person = required(
    (
      await db
        .insert(persons)
        .values({
          name: "Linked person",
          ownerId,
          visibilityLevel: options.visibility ?? "owner",
          visibleToUserIds: options.visibleToUserIds ?? [],
          deletedAt: options.deleted === "person" ? new Date() : null,
        })
        .returning({ id: persons.id })
    )[0],
  );
  return { dealId: deal.id, personId: person.id };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
const draft = { to: ["recipient@example.com"], subject: "Visibility check", body: "Unsent text" };

async function expectRejected(
  db: TestDb,
  fixture: Fixture,
  links: { dealId?: string; personId?: string },
  errorId: string,
) {
  const result = await fixture.tools.invoke("create_email_draft", { ...draft, ...links });
  const first = result.content[0];
  const text = first?.type === "text" ? first.text : "";
  // Read the side effect even when the error assertion fails, so the RED records both leaks.
  const stored = await db.select({ id: emailDrafts.id }).from(emailDrafts);
  expect.soft(result.isError).toBe(true);
  expect.soft(text).toMatch(new RegExp(`^${errorId}:`));
  expect(stored).toEqual([]);
}

describe("MCP draft CRM-link visibility", () => {
  it("create_email_draft rejects another actor's owner-only deal", async () => {
    await withTestDb(async (db) => {
      const fixture = await setup(db);
      const { dealId } = await seedLinks(db, fixture.other.id);
      expect(await canSeeLinkedDeal(db, fixture.actor, dealId, signal())).toBe(false);

      await expectRejected(db, fixture, { dealId }, ERROR_IDS.DEAL_NOT_FOUND);
    });
  });

  it("rejects an explicitly hidden person even alongside a visible deal", async () => {
    await withTestDb(async (db) => {
      const fixture = await setup(db);
      const { dealId } = await seedLinks(db, fixture.user.id);
      const { personId } = await seedLinks(db, fixture.other.id);
      expect(await canSeeLinkedDeal(db, fixture.actor, dealId, signal())).toBe(true);
      expect(await canSeeLinkedPerson(db, fixture.actor, personId, signal())).toBe(false);

      await expectRejected(db, fixture, { dealId, personId }, ERROR_IDS.CONTACT_NOT_FOUND);
    });
  });

  it.each(["deal", "person"] as const)("rejects a soft-deleted %s link", async (kind) => {
    await withTestDb(async (db) => {
      const fixture = await setup(db);
      const links = await seedLinks(db, fixture.user.id, { deleted: kind });
      const visible = kind === "deal" ? canSeeLinkedDeal : canSeeLinkedPerson;
      const id = kind === "deal" ? links.dealId : links.personId;
      expect(await visible(db, fixture.actor, id, signal())).toBe(false);

      await expectRejected(
        db,
        fixture,
        kind === "deal" ? { dealId: id } : { personId: id },
        kind === "deal" ? ERROR_IDS.DEAL_NOT_FOUND : ERROR_IDS.CONTACT_NOT_FOUND,
      );
    });
  });

  it("rejects an owned deal in an archived pipeline", async () => {
    await withTestDb(async (db) => {
      const fixture = await setup(db);
      const { dealId } = await seedLinks(db, fixture.user.id, { archivedPipeline: true });
      expect(await canSeeLinkedDeal(db, fixture.actor, dealId, signal())).toBe(false);

      await expectRejected(db, fixture, { dealId }, ERROR_IDS.DEAL_NOT_FOUND);
    });
  });

  it("honors the pipeline restriction even for an owned, explicitly allowed deal", async () => {
    await withTestDb(async (db) => {
      const fixture = await setup(db);
      const { dealId } = await seedLinks(db, fixture.user.id, {
        restrictedPipeline: true,
        visibleToUserIds: [fixture.user.id],
      });
      expect(await canSeeLinkedDeal(db, fixture.actor, dealId, signal())).toBe(false);

      await expectRejected(db, fixture, { dealId }, ERROR_IDS.DEAL_NOT_FOUND);
    });
  });

  it.each(["owned", "public", "explicitly allowed"] as const)(
    "preserves visible %s deal and person links",
    async (visibility) => {
      await withTestDb(async (db) => {
        const fixture = await setup(db);
        const links = await seedLinks(
          db,
          visibility === "owned" ? fixture.user.id : fixture.other.id,
          {
            visibility: visibility === "public" ? "all" : "owner",
            visibleToUserIds: visibility === "explicitly allowed" ? [fixture.user.id] : [],
          },
        );
        expect(await canSeeLinkedDeal(db, fixture.actor, links.dealId, signal())).toBe(true);
        expect(await canSeeLinkedPerson(db, fixture.actor, links.personId, signal())).toBe(true);

        const result = await fixture.tools.invoke("create_email_draft", { ...draft, ...links });
        expect(result.isError).not.toBe(true);
        const stored = await db
          .select({
            accountId: emailDrafts.accountId,
            dealId: emailDrafts.linkDealId,
            personId: emailDrafts.linkPersonId,
          })
          .from(emailDrafts)
          .where(eq(emailDrafts.accountId, fixture.account.id));
        expect(stored).toEqual([{ accountId: fixture.account.id, ...links }]);
      });
    },
  );
});
