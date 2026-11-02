import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { deals, leads, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { getWorkspace } from "@/features/deal-workspace/summaryRepo";
import { getLeadById, getLeadRelations, listLeads } from "@/features/leads/leadRepo";
import { getBoardColumns, listDeals } from "./dealRepo";

const signal = () => new AbortController().signal;
const viewer = (id: string) => ({
  id,
  type: "regular" as const,
  isActive: true,
  groupIds: new Set<string>(),
});
const session = (userId: string) => ({
  userId,
  isAdmin: false,
  isActive: true,
  sessionLive: true,
  visibilityGroupIds: [] as string[],
  managedUserIds: [] as string[],
});
const leadListInput = {
  filter: "inbox" as const,
  offset: 0,
  limit: 100,
  sort: { field: "createdAt" as const, dir: "desc" as const },
  filters: {},
};

it("redacts independently private contact rows, names, and IDs from visible deals and leads", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const pipe = await seedPipelineWithStages(db, ["Open"]);
    const [person] = await db
      .insert(persons)
      .values({
        name: "Private person",
        primaryEmail: "private@example.com",
        ownerId: owner.id,
        visibilityLevel: "owner",
      })
      .returning();
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Private organization",
        domain: "private.example",
        ownerId: owner.id,
        visibilityLevel: "owner",
      })
      .returning();
    if (!person || !org) throw new Error("contact seed failed");
    const [deal] = await db
      .insert(deals)
      .values({
        title: "Visible deal",
        pipelineId: pipe.pipeline.id,
        stageId: pipe.stages[0]!.id,
        ownerId: owner.id,
        visibilityLevel: "all",
        personId: person.id,
        orgId: org.id,
      })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        title: "Visible lead",
        ownerId: owner.id,
        visibilityLevel: "all",
        personId: person.id,
        orgId: org.id,
      })
      .returning();
    if (!deal || !lead) throw new Error("parent seed failed");

    const detail = await getWorkspace(db, viewer(other.id), deal.id, signal());
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.person).toBeNull();
    expect(detail.value.org).toBeNull();
    expect(detail.value.deal.personId).toBeNull();
    expect(detail.value.deal.orgId).toBeNull();

    const board = await getBoardColumns(db, session(other.id), pipe.pipeline.id, signal());
    const card = board.cards.find((row) => row.id === deal.id);
    expect(card).toMatchObject({ personId: null, orgId: null, personName: null, orgName: null });
    const list = await listDeals(db, session(other.id), { offset: 0, limit: 100 }, signal());
    expect(list.rows.find((row) => row.id === deal.id)).toMatchObject({
      personId: null,
      orgId: null,
      personName: null,
      orgName: null,
    });

    const leadDetail = await getLeadById(db, session(other.id), lead.id, signal());
    expect(leadDetail).toMatchObject({
      personId: null,
      orgId: null,
      personName: null,
      orgName: null,
    });
    const leadList = await listLeads(db, session(other.id), leadListInput, signal());
    expect(leadList.rows.find((row) => row.id === lead.id)).toMatchObject({
      personName: null,
      orgName: null,
    });
    const relations = await getLeadRelations(db, viewer(other.id), lead, signal());
    expect(relations).toEqual({ person: null, org: null });

    const ownerWorkspace = await getWorkspace(db, viewer(owner.id), deal.id, signal());
    expect(ownerWorkspace.ok && ownerWorkspace.value.person?.primaryEmail).toBe(
      "private@example.com",
    );
    const ownerLead = await getLeadById(db, session(owner.id), lead.id, signal());
    expect(ownerLead?.personId).toBe(person.id);
    expect(ownerLead?.orgId).toBe(org.id);
  });
});

it("omits soft-deleted linked contact names and IDs from board, list, and lead detail", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const pipe = await seedPipelineWithStages(db, ["Open"]);
    const [person] = await db
      .insert(persons)
      .values({ name: "Deleted contact", ownerId: owner.id, visibilityLevel: "all" })
      .returning();
    if (!person) throw new Error("person seed failed");
    const [deal] = await db
      .insert(deals)
      .values({
        title: "Deal",
        pipelineId: pipe.pipeline.id,
        stageId: pipe.stages[0]!.id,
        ownerId: owner.id,
        visibilityLevel: "all",
        personId: person.id,
      })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ title: "Lead", ownerId: owner.id, visibilityLevel: "all", personId: person.id })
      .returning();
    if (!deal || !lead) throw new Error("parent seed failed");
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, person.id));

    const board = await getBoardColumns(db, session(owner.id), pipe.pipeline.id, signal());
    expect(board.cards.find((row) => row.id === deal.id)).toMatchObject({
      personId: null,
      personName: null,
    });
    const list = await listDeals(db, session(owner.id), { offset: 0, limit: 100 }, signal());
    expect(list.rows.find((row) => row.id === deal.id)).toMatchObject({
      personId: null,
      personName: null,
    });
    const detail = await getLeadById(db, session(owner.id), lead.id, signal());
    expect(detail).toMatchObject({ personId: null, personName: null });
    const leadList = await listLeads(db, session(owner.id), leadListInput, signal());
    expect(leadList.rows.find((row) => row.id === lead.id)?.personName).toBeNull();
  });
});
