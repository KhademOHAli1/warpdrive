import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import type { DashboardFilters } from "@/types/stats";
import { dealRecords } from "./dealRecords";
import { serializeDealReportExport } from "./dealReportExportCsv";
import { dealReportExportHref, parseDealReportExportRequest } from "./dealReportExportRequest";
import { lostReasonBreakdown } from "./lostReasons";
import { ANALYTICS_METRIC_DICTIONARY_VERSION } from "./metricDictionary";
import { EVERYONE, onlyOwners } from "./ownerIds";
import { seedDeal, seedPipeline, seedUser, toActor } from "./statsTestHelpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

const BASE: DashboardFilters = {
  pipelineId: null,
  owners: EVERYONE,
  from: "2025-01-01",
  to: "2025-12-31",
};

async function seedReason(name: string) {
  const [r] = await h.db.insert(schema.lostReasons).values({ name }).returning();
  if (r === undefined) throw new Error("no reason row");
  return r;
}

describe("lostReasonBreakdown", () => {
  it("reconciles configured, exact legacy, blank and missing groups with live records and CSV", async () => {
    const user = await seedUser(h);
    const other = await seedUser(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const label = '=HYPERLINK("https://private.invalid") Café';
    const sameLabel = await seedReason(label);
    const common = {
      title: "Report deal",
      status: "lost",
      currency: "EUR",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
      lostTime: new Date("2025-05-01T00:00:00Z"),
    } as const;
    const configured = await seedDeal(h, {
      ...common,
      lostReasonId: sameLabel.id,
      lostReason: "ignored because configured",
      value: "11.1234",
    });
    const legacy = await seedDeal(h, { ...common, lostReason: label, value: "22.1234" });
    const differentText = await seedDeal(h, {
      ...common,
      lostReason: `${label} `,
      value: "33.1234",
    });
    const blank = await seedDeal(h, { ...common, lostReason: "", value: "44.1234" });
    const missing = await seedDeal(h, { ...common, lostReason: null, value: "55.1234" });
    await seedDeal(h, { ...common, lostReason: label, currency: "USD", value: "99.00" });
    await seedDeal(h, {
      ...common,
      lostReason: label,
      visibilityLevel: "owner",
      ownerId: other.id,
      value: "99.00",
    });

    const actor = toActor(user);
    const filters = {
      ...BASE,
      pipelineId: pipeline.id,
      owners: onlyOwners([user.id]),
      currency: "EUR",
      timeZone: "UTC",
    };
    const signal = () => AbortSignal.timeout(10_000);
    const chart = await lostReasonBreakdown(h.db, actor, filters, signal());
    expect(chart).toHaveLength(5);
    for (const [reasonId, name, deal] of [
      [sameLabel.id, label, configured],
      [null, label, legacy],
      [null, `${label} `, differentText],
      [null, "", blank],
      [null, null, missing],
    ] as const) {
      const group = chart.find((row) => row.reasonId === reasonId && row.name === name);
      if (group?.selector === undefined) throw new Error("No selectable chart group");
      const page = await dealRecords(
        h.db,
        actor,
        filters,
        { metric: "lost", limit: 25, lostReason: group.selector },
        signal(),
      );
      expect(page.rows.map(({ id }) => id)).toEqual([deal.id]);
      expect(page.totals).toEqual({ count: group.count, value: group.value, valueCount: 1 });
    }

    const legacySelector = chart.find(
      (row) => row.reasonId === null && row.name === label,
    )?.selector;
    if (legacySelector === undefined) throw new Error("No sealed legacy group");
    const scope = {
      from: filters.from,
      to: filters.to,
      pipelineId: pipeline.id,
      currency: "EUR",
      ownerScope: { kind: "me" },
      metric: "lost",
      timeZone: "UTC",
      lostReason: legacySelector,
    } as const;
    const href = dealReportExportHref(scope);
    if (href === null) throw new Error("Expected a bounded lost-group URL");
    expect(href).not.toContain(encodeURIComponent(label));
    expect(parseDealReportExportRequest(new URL(href, "https://example.invalid"))).toEqual(scope);
    const input = { metric: "lost", limit: 25, lostReason: legacySelector } as const;
    const page = await dealRecords(h.db, actor, filters, input, signal());
    const csv = serializeDealReportExport(
      {
        ...page,
        metric: "lost",
        currency: "EUR",
        timeZone: "UTC",
        definitionVersion: ANALYTICS_METRIC_DICTIONARY_VERSION,
        effectiveOwnerScope: scope.ownerScope,
        lostReason: legacySelector,
      },
      scope,
    );
    expect(csv.state).toBe("ready");
    if (csv.state !== "ready") throw new Error("Expected the scoped CSV");
    expect(csv.csv).toContain(legacy.id);
    expect(csv.csv).not.toContain(label);
    expect(csv.csv).not.toContain(legacySelector);
    expect(csv.csv).not.toContain(configured.id);
    await expect(dealRecords(h.db, toActor(other), filters, input, signal())).rejects.toThrow(
      "Lost reason selection is unavailable",
    );
    await expect(
      dealRecords(h.db, actor, { ...filters, from: "2025-01-02" }, input, signal()),
    ).rejects.toThrow("Lost reason selection is unavailable");
    const tampered = legacySelector.slice(0, -1) + (legacySelector.endsWith("A") ? "B" : "A");
    await expect(
      dealRecords(h.db, actor, filters, { ...input, lostReason: tampered }, signal()),
    ).rejects.toThrow("Lost reason selection is unavailable");
  });

  it("groups lost deals by their selected reason, with count and value", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const price = await seedReason(`Price-${Date.now()}`);

    for (const value of ["100.00", "300.00"]) {
      await seedDeal(h, {
        title: `lost ${value}`,
        status: "lost",
        value,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: user.id,
        visibilityLevel: "all",
        lostTime: new Date("2025-05-01T00:00:00Z"),
        lostReasonId: price.id,
      });
    }

    const rows = await lostReasonBreakdown(
      h.db,
      toActor(user),
      { ...BASE, pipelineId: pipeline.id },
      new AbortController().signal,
    );
    const row = rows.find((r) => r.reasonId === price.id);
    expect(row?.count).toBe(2);
    expect(Number(row?.value)).toBe(400);
    expect(row?.name).toBe(price.name);
  });

  it("keeps deals lost with no reason in their own bucket rather than dropping them", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "lost, no reason given",
      status: "lost",
      value: "50.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
      lostTime: new Date("2025-05-01T00:00:00Z"),
    });

    const rows = await lostReasonBreakdown(
      h.db,
      toActor(user),
      { ...BASE, pipelineId: pipeline.id },
      new AbortController().signal,
    );
    const unspecified = rows.find((r) => r.reasonId === null);
    expect(unspecified?.count).toBe(1);
    expect(unspecified?.name).toBeNull();
  });

  it("falls back to the free-text reason when no reason row was selected", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "lost with typed reason",
      status: "lost",
      value: "70.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
      lostTime: new Date("2025-05-01T00:00:00Z"),
      lostReason: "Went with a competitor",
    });

    const rows = await lostReasonBreakdown(
      h.db,
      toActor(user),
      { ...BASE, pipelineId: pipeline.id },
      new AbortController().signal,
    );
    expect(rows.find((r) => r.name === "Went with a competitor")?.count).toBe(1);
  });

  it("windows on lost time", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "lost next year",
      status: "lost",
      value: "9.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
      lostTime: new Date("2026-05-01T00:00:00Z"),
    });

    const rows = await lostReasonBreakdown(
      h.db,
      toActor(user),
      { ...BASE, pipelineId: pipeline.id },
      new AbortController().signal,
    );
    expect(rows).toHaveLength(0);
  });

  it("SECURITY: an owner-only lost deal is invisible to a third party", async () => {
    const alice = await seedUser(h);
    const bob = await seedUser(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "bob's loss",
      status: "lost",
      value: "4000.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: bob.id,
      visibilityLevel: "owner",
      lostTime: new Date("2025-05-01T00:00:00Z"),
    });

    const rows = await lostReasonBreakdown(
      h.db,
      toActor(alice),
      { ...BASE, pipelineId: pipeline.id },
      new AbortController().signal,
    );
    expect(rows).toHaveLength(0);
  });
});
