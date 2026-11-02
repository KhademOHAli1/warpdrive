import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activities, importRows, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { commitBatch, createBatch, setMapping, validateBatch } from "./batch";
import { parseCsv } from "./csvParse";
import { adminActorFor } from "./pipedriveImport.testHelpers";

const signal = () => AbortSignal.timeout(20_000);
const column = (field: string) => ({ field, isCustom: false, key: "" });
describe("regional CSV validation and persistence", () => {
  it("round-trips Persian all-day and timed activities using the selected zone even when the actor profile is Berlin", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const actor = adminActorFor(user.id);
      await setPreferences(db, user.id, { timezone: "Europe/Berlin" }, signal());
      const raw = [
        { Subject: "روز نخست", Date: "۱۴۰۵/۰۱/۰۱", Time: "" },
        { Subject: "تماس", Date: "۱۴۰۵/۰۱/۰۱ ۰۹:۳۰", Time: "" },
      ];
      const created = await createBatch(
        db,
        actor,
        { targetEntity: "activity", filename: "persian.csv", rows: raw },
        signal(),
      );
      if (!created.ok) throw created.error;
      const id = created.value.batchId;
      expect(
        (
          await setMapping(
            db,
            actor,
            id,
            {
              columns: { Subject: column("subject"), Date: column("dueAt") },
              options: { dateCalendar: "persian", dateTimeZone: "Asia/Tehran" },
            },
            signal(),
          )
        ).ok,
      ).toBe(true);
      expect(await validateBatch(db, actor, id, signal())).toEqual({
        ok: true,
        value: { valid: 2, invalid: 0 },
      });
      expect((await commitBatch(db, actor, id, signal())).ok).toBe(true);
      const rows = await db.select().from(activities);
      const allDay = rows.find((row) => row.subject === "روز نخست");
      expect(allDay).toMatchObject({ allDay: true, dueDate: "2026-03-21" });
      expect(allDay?.dueAt?.toISOString()).toBe("2026-03-20T20:30:00.000Z");
      const timed = rows.find((row) => row.subject === "تماس");
      expect(timed).toMatchObject({ allDay: false, dueDate: null });
      expect(timed?.dueAt?.toISOString()).toBe("2026-03-21T06:00:00.000Z");
      const sourceRows = await db.select().from(importRows).where(eq(importRows.batchId, id));
      expect(sourceRows.map((row) => row.raw)).toEqual(raw);
    });
  });

  it("requires review of Berlin gaps and overlaps while accepting explicit offsets", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const actor = adminActorFor(user.id);
      const created = await createBatch(
        db,
        actor,
        {
          targetEntity: "activity",
          filename: "berlin.csv",
          rows: [
            { Subject: "Gap", Due: "2026-03-29 02:30" },
            { Subject: "Overlap", Due: "2026-10-25 02:30" },
            { Subject: "Chosen", Due: "2026-10-25T02:30:00+01:00" },
          ],
        },
        signal(),
      );
      if (!created.ok) throw created.error;
      const id = created.value.batchId;
      expect(
        (
          await setMapping(
            db,
            actor,
            id,
            {
              columns: { Subject: column("subject"), Due: column("dueAt") },
              options: { dateCalendar: "gregory", dateTimeZone: "Europe/Berlin" },
            },
            signal(),
          )
        ).ok,
      ).toBe(true);
      expect(await validateBatch(db, actor, id, signal())).toEqual({
        ok: true,
        value: { valid: 1, invalid: 2 },
      });
      const checked = await db.select().from(importRows).where(eq(importRows.batchId, id));
      expect(checked.find((row) => row.raw.Subject === "Gap")?.errors).toContainEqual({
        field: "dueAt",
        message: "local time does not exist in the selected time zone",
      });
      expect(checked.find((row) => row.raw.Subject === "Overlap")?.errors).toContainEqual({
        field: "dueAt",
        message: "ambiguous local time; include an explicit UTC offset",
      });
      expect((await commitBatch(db, actor, id, signal())).ok).toBe(true);
      const stored = await db.select().from(activities);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dueAt?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    });
  });

  it("preserves authored German phone digits through CSV commit and keeps legacy date-only import semantics", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db);
      const actor = adminActorFor(user.id);
      const rawPhone = " ۰۳۰ ۲۳۱۲۵ ۰۰۰ ";
      const created = await createBatch(
        db,
        actor,
        {
          targetEntity: "person",
          filename: "phones.csv",
          rows: parseCsv(`Name,Phone\nKontakt,"${rawPhone}"\n`).rows,
        },
        signal(),
      );
      if (!created.ok) throw created.error;
      const id = created.value.batchId;
      await setMapping(
        db,
        actor,
        id,
        {
          columns: { Name: column("name"), Phone: column("phones") },
          options: { phoneCountry: "DE" },
        },
        signal(),
      );
      expect((await validateBatch(db, actor, id, signal())).ok).toBe(true);
      expect((await commitBatch(db, actor, id, signal())).ok).toBe(true);
      expect((await db.select().from(persons))[0]?.phones).toEqual([
        {
          label: "work",
          value: rawPhone,
          country: "DE",
          e164: "+493023125000",
          normalization: "valid",
          primary: true,
        },
      ]);
      const legacy = await createBatch(
        db,
        actor,
        {
          targetEntity: "activity",
          filename: "legacy.csv",
          rows: [{ Subject: "Legacy", Due: "2026-03-21" }],
        },
        signal(),
      );
      if (!legacy.ok) throw legacy.error;
      await setMapping(
        db,
        actor,
        legacy.value.batchId,
        { columns: { Subject: column("subject"), Due: column("dueAt") } },
        signal(),
      );
      await validateBatch(db, actor, legacy.value.batchId, signal());
      expect((await commitBatch(db, actor, legacy.value.batchId, signal())).ok).toBe(true);
      const [stored] = await db.select().from(activities);
      expect(stored).toMatchObject({ allDay: false, dueDate: null });
      expect(stored?.dueAt?.toISOString()).toBe("2026-03-21T00:00:00.000Z");
    });
  });
});
