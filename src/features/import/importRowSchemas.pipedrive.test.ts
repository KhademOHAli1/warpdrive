import { describe, expect, it } from "vitest";
import {
  activityImportRowSchema,
  dealImportRowSchema,
  noteImportRowSchema,
  orgImportGroupSchema,
  personImportGroupSchema,
} from "./importRowSchemas";

const dealBase = { title: "Big deal" };
const activityBase = { subject: "Call" };

describe("organization and person groups", () => {
  it("accepts a pipedriveId without a name", () => {
    expect(orgImportGroupSchema.safeParse({ pipedriveId: "42" }).success).toBe(true);
    expect(personImportGroupSchema.safeParse({ pipedriveId: "42" }).success).toBe(true);
  });

  it("still requires a name when no pipedriveId is present", () => {
    for (const schema of [orgImportGroupSchema, personImportGroupSchema]) {
      const r = schema.safeParse({});
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("treats a blank pipedriveId as absent", () => {
    expect(orgImportGroupSchema.safeParse({ pipedriveId: "  " }).success).toBe(false);
    expect(orgImportGroupSchema.safeParse({ name: "Acme", pipedriveId: " " }).success).toBe(true);
  });

  it("keeps an optional owner", () => {
    const r = orgImportGroupSchema.parse({ name: "Acme", owner: "Dana" });
    expect(r.owner).toBe("Dana");
    expect(personImportGroupSchema.parse({ name: "Sam", owner: "Dana" }).owner).toBe("Dana");
  });
});

describe("deal row", () => {
  it("parses status case-insensitively and rejects other values", () => {
    expect(dealImportRowSchema.parse({ ...dealBase, status: " WON " }).status).toBe("won");
    expect(dealImportRowSchema.parse({ ...dealBase, status: "Open" }).status).toBe("open");
    expect(dealImportRowSchema.safeParse({ ...dealBase, status: "deleted" }).success).toBe(false);
  });

  it("parses wonTime, lostTime and createdAt through the shared date parser", () => {
    const r = dealImportRowSchema.parse({
      ...dealBase,
      wonTime: "2026-03-04 09:30",
      lostTime: "2026-03-05",
      createdAt: "2026-03-01T10:00:00+02:00",
    });
    expect(r.wonTime).toBe("2026-03-04T09:30:00.000Z");
    expect(r.lostTime).toBe("2026-03-05T00:00:00.000Z");
    expect(r.createdAt).toBe("2026-03-01T08:00:00.000Z");
    const bad = dealImportRowSchema.safeParse({ ...dealBase, wonTime: "soon" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["wonTime"]);
  });

  it("trims lostReason and caps it at 255", () => {
    expect(dealImportRowSchema.parse({ ...dealBase, lostReason: "  too pricey " }).lostReason).toBe(
      "too pricey",
    );
    expect(
      dealImportRowSchema.safeParse({ ...dealBase, lostReason: "x".repeat(256) }).success,
    ).toBe(false);
  });

  it("splits labels on commas, trims, drops empties and dedupes", () => {
    const r = dealImportRowSchema.parse({ ...dealBase, labels: " hot, , warm,hot ,Warm" });
    expect(r.labels).toEqual(["hot", "warm", "Warm"]);
  });

  it("keeps pipedriveId and owner and leaves them off when unmapped", () => {
    const r = dealImportRowSchema.parse({ ...dealBase, pipedriveId: " 7 ", owner: "Dana" });
    expect(r.pipedriveId).toBe("7");
    expect(r.owner).toBe("Dana");
    const bare = dealImportRowSchema.parse(dealBase);
    expect(bare.pipedriveId).toBeUndefined();
    expect(bare.status).toBeUndefined();
  });
});

describe("activity row", () => {
  it.each(["1", "true", "YES", "Done", " done "])("reads %s as done", (v) => {
    expect(activityImportRowSchema.parse({ ...activityBase, done: v }).done).toBe(true);
  });

  it.each(["0", "false", "No", ""])("reads %j as not done", (v) => {
    expect(activityImportRowSchema.parse({ ...activityBase, done: v }).done).toBe(false);
  });

  it("rejects any other done value", () => {
    const r = activityImportRowSchema.safeParse({ ...activityBase, done: "maybe" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["done"]);
  });

  it("parses doneAt and dueAt through the shared date parser", () => {
    const r = activityImportRowSchema.parse({
      ...activityBase,
      doneAt: "2026-03-04 09:30",
      dueAt: "2026-03-04",
    });
    expect(r.doneAt).toBe("2026-03-04T09:30:00.000Z");
    expect(r.dueAt).toBe("2026-03-04T00:00:00.000Z");
    expect(activityImportRowSchema.safeParse({ ...activityBase, doneAt: "x" }).success).toBe(false);
  });

  it("keeps the assignee, pipedriveId and link fields", () => {
    const r = activityImportRowSchema.parse({
      ...activityBase,
      assignee: "Dana",
      pipedriveId: "9",
      dealPipedriveId: "1",
      personPipedriveId: "2",
      orgPipedriveId: "3",
      dealTitle: "D",
      personName: "P",
      orgName: "O",
    });
    expect(r).toMatchObject({
      assignee: "Dana",
      pipedriveId: "9",
      dealPipedriveId: "1",
      personPipedriveId: "2",
      orgPipedriveId: "3",
      dealTitle: "D",
      personName: "P",
      orgName: "O",
    });
  });

  it("still rejects an unparseable dueAt and defaults it to null", () => {
    expect(activityImportRowSchema.safeParse({ ...activityBase, dueAt: "nope" }).success).toBe(
      false,
    );
    expect(activityImportRowSchema.parse(activityBase).dueAt).toBeNull();
  });
});

describe("note row", () => {
  it("requires a body and caps it at 50k", () => {
    expect(noteImportRowSchema.safeParse({}).success).toBe(false);
    expect(noteImportRowSchema.safeParse({ body: "  " }).success).toBe(false);
    expect(noteImportRowSchema.safeParse({ body: "x".repeat(50_001) }).success).toBe(false);
    expect(noteImportRowSchema.parse({ body: " hi " }).body).toBe("hi");
  });

  it("keeps createdAt, pipedriveId and the six link fields", () => {
    const r = noteImportRowSchema.parse({
      body: "n",
      createdAt: "2026-03-04",
      pipedriveId: "5",
      dealPipedriveId: "1",
      personPipedriveId: "2",
      orgPipedriveId: "3",
      dealTitle: "D",
      personName: "P",
      orgName: "O",
    });
    expect(r.createdAt).toBe("2026-03-04T00:00:00.000Z");
    expect(r.pipedriveId).toBe("5");
    expect(r.orgName).toBe("O");
  });
});
