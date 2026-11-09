import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { setPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { readRecordedDealSourceReport } from "./recordedDealSourceReport";

const from = "2026-05-01";
const signal = () => AbortSignal.timeout(10_000);
const inDay = "2026-05-01T00:00:00.000000Z";

async function seedUser(h: TestDb) {
  const id = randomUUID();
  await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Recorded source viewer')", [
    id,
    `${id}@example.test`,
  ]);
  return id;
}

async function seedPipeline(h: TestDb, groupId: string | null) {
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  await h.pool.query(
    'INSERT INTO pipelines (id,name,"order",visibility_group_id) VALUES ($1,$2,0,$3)',
    [pipelineId, `Fixture pipeline ${pipelineId}`, groupId],
  );
  await h.pool.query(
    "INSERT INTO stages (id,pipeline_id,name,\"order\") VALUES ($1,$2,'Initial',0)",
    [stageId, pipelineId],
  );
  return { pipelineId, stageId };
}

type DealFixture = {
  source: string | null;
  value: string | null;
  created?: string;
  won?: string;
  lost?: string;
  currency?: "EUR" | "USD";
  archived?: boolean;
};

async function seedDeal(
  h: TestDb,
  scope: { ownerId: string; pipelineId: string; stageId: string },
  deal: DealFixture,
) {
  const status = deal.won !== undefined ? "won" : deal.lost !== undefined ? "lost" : "open";
  await h.pool.query(
    `INSERT INTO deals (title,owner_id,pipeline_id,stage_id,visibility_level,currency,value,
      source_channel,source_channel_id,status,created_at,won_time,lost_time,archived_at)
      VALUES ('Private fixture title',$1,$2,$3,'owner',$4,$5,$6,'Private campaign reference',
        $7,$8,$9,$10,$11)`,
    [
      scope.ownerId,
      scope.pipelineId,
      scope.stageId,
      deal.currency ?? "EUR",
      deal.value,
      deal.source,
      status,
      deal.created ?? inDay,
      deal.won ?? null,
      deal.lost ?? null,
      deal.archived === true ? inDay : null,
    ],
  );
}

function requestActor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set<PermissionFlagKey>(["stats.viewOthers"]),
  };
}

describe("native recorded deal source report", () => {
  test("aggregates recorded channels within the authorized current population and exact civil day", async () => {
    const h = await makeTestDb();
    try {
      const id = await seedUser(h);
      const otherId = await seedUser(h);
      const restrictedGroup = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups (id,name) VALUES ($1,'Hidden sources')", [
        restrictedGroup,
      ]);
      const visible = await seedPipeline(h, null);
      const hidden = await seedPipeline(h, restrictedGroup);
      await setPreferences(
        h.db,
        id,
        {
          ui: {
            localePreferences: {
              locale: "en",
              calendar: "gregory",
              timeZone: "Europe/Berlin",
              timeZoneMode: "manual",
            },
          },
        },
        signal(),
      );
      const own = { ...visible, ownerId: id };
      const campaign = {
        source: "campaign",
        value: "0",
        won: "2026-04-30T22:00:00Z",
        created: "2026-04-30T21:00:00Z",
      };
      await seedDeal(h, own, campaign);
      await seedDeal(h, own, {
        source: "campaign",
        value: "140.7067",
        created: "2026-05-01T00:00:00.000001Z",
        won: "2026-05-01T00:00:00.000002Z",
      });
      await seedDeal(h, own, {
        source: "private imported legacy text",
        value: null,
        created: "2026-05-01T01:00:00Z",
        won: inDay,
      });
      await seedDeal(h, own, { source: null, value: "10", lost: "2026-05-01T12:00:00Z" });
      await seedDeal(h, own, { ...campaign, won: "2026-05-01T22:00:00Z", value: "999" });
      await seedDeal(h, own, { ...campaign, currency: "USD", value: "999" });
      await seedDeal(h, own, { ...campaign, archived: true, value: "999" });
      await seedDeal(h, { ...hidden, ownerId: id }, { ...campaign, value: "999" });
      await seedDeal(h, { ...visible, ownerId: otherId }, { ...campaign, value: "999" });

      const input = {
        from,
        to: from,
        currency: "EUR",
        ownerScope: { kind: "all" } as const,
        timeZoneIdentity: "America/Los_Angeles",
      };
      expect(await readRecordedDealSourceReport(h.db, requestActor(id), input, signal())).toEqual({
        state: "available",
        definition: "recorded-deal-source-current-v1",
        currency: "EUR",
        timeZone: "Europe/Berlin",
        effectiveOwnerScope: "me",
        rows: [
          {
            channel: "campaign",
            added: 1,
            won: 2,
            lost: 0,
            wonValueCount: 2,
            wonValue: "140.7067",
            wonCycleCount: 2,
            wonCycleMicroseconds: "3600000001",
          },
          {
            channel: "unrecognized",
            added: 1,
            won: 1,
            lost: 0,
            wonValueCount: 0,
            wonValue: null,
            wonCycleCount: 0,
            wonCycleMicroseconds: null,
          },
          {
            channel: "unrecorded",
            added: 1,
            won: 0,
            lost: 1,
            wonValueCount: 0,
            wonValue: null,
            wonCycleCount: 0,
            wonCycleMicroseconds: null,
          },
        ],
      });
      expect(
        await readRecordedDealSourceReport(
          h.db,
          requestActor(id),
          { ...input, pipelineId: hidden.pipelineId },
          signal(),
        ),
      ).toEqual({ state: "unavailable" });
      await h.pool.query("UPDATE users SET is_active=false WHERE id=$1", [id]);
      expect(await readRecordedDealSourceReport(h.db, requestActor(id), input, signal())).toEqual({
        state: "permission",
      });
    } finally {
      await h.close();
    }
  });
});
