import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLogs, organizations } from "@/db/schema";
import { leads } from "@/db/schema/leads";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { recordChange } from "@/features/collaboration/changeLog";
import type { Locale } from "@/features/i18n/registry";
import { getPreferences, setPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import type { NumberingSystem } from "@/lib/numberingSystem";
import { makeCaller } from "@/server/testCaller";

const OLD = "1234.5678";
const EXACT = "9007199254740993.1234567890123456789";
const AUTHORED_OLD = "001234.56";
const REFERENCE = "0001234.5678";

function actor(id: string): PermSetUser {
  return { id, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() };
}

function withoutIsolation(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

const displays: Array<{
  name: string;
  locale: Locale;
  numberingSystem?: NumberingSystem;
  old: string;
  exact: string;
}> = [
  {
    name: "German",
    locale: "de",
    old: "1.234,5678",
    exact: "9.007.199.254.740.993,1234567890123456789",
  },
  {
    name: "Farsi Latin digits",
    locale: "fa",
    numberingSystem: "latn",
    old: "1,234.5678",
    exact: "9,007,199,254,740,993.1234567890123456789",
  },
  {
    name: "Farsi Persian digits",
    locale: "fa",
    numberingSystem: "arabext",
    old: "۱٬۲۳۴٫۵۶۷۸",
    exact: "۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳٫۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹",
  },
];

describe.each(["lead", "organization"] as const)("%s timeline localized audit reads", (kind) => {
  it.each(displays)(
    "renders $name exactly while retaining authored data, audit identities and visibility",
    async (display) => {
      await withTestDb(async (db) => {
        const owner = await seedUser(db, { name: "Jörg Owner" });
        const stranger = await seedUser(db);
        const [entity] =
          kind === "lead"
            ? await db
                .insert(leads)
                .values({ title: "Private lead", ownerId: owner.id, visibilityLevel: "owner" })
                .returning()
            : await db
                .insert(organizations)
                .values({
                  name: "Private organization",
                  ownerId: owner.id,
                  visibilityLevel: "owner",
                })
                .returning();
        if (entity === undefined) throw new Error("timeline entity seed failed");
        const numericField = kind === "lead" ? "value" : "org.annualRevenue";
        const titleField = kind === "lead" ? "title" : "name";
        const referenceField =
          kind === "lead" ? "source_channel_id" : "custom_field:external_reference";
        const numericNew = kind === "lead" ? EXACT : { value: EXACT, providers: ["apollo"] };
        const signal = new AbortController().signal;
        for (const entry of [
          { field: numericField, oldValue: OLD, newValue: numericNew },
          { field: titleField, oldValue: AUTHORED_OLD, newValue: EXACT },
          { field: referenceField, oldValue: "external-0012", newValue: REFERENCE },
        ]) {
          await recordChange(
            db,
            { entityType: kind, entityId: entity.id, actorId: owner.id, ...entry },
            signal,
          );
        }
        const accountPreferences = {
          locale: display.locale,
          calendar: "gregory",
          timeZone: "UTC",
          ...(display.numberingSystem === undefined
            ? {}
            : { numberingSystem: display.numberingSystem }),
        } as const;
        await setPreferences(
          db,
          owner.id,
          { ui: { localePreferences: accountPreferences } },
          signal,
        );
        const savedPreferences = (await getPreferences(db, owner.id, signal)).ui.localePreferences;
        expect(savedPreferences).toEqual(accountPreferences);
        if (savedPreferences === undefined) throw new Error("saved locale preferences missing");
        // Read jsonb as text to prove no numeric conversion or write was hidden by a mapper.
        const snapshot = () =>
          db
            .select({
              id: changeLogs.id,
              entityType: changeLogs.entityType,
              entityId: changeLogs.entityId,
              field: changeLogs.field,
              oldValue: sql<string>`${changeLogs.oldValue}::text`,
              newValue: sql<string>`${changeLogs.newValue}::text`,
              actorId: changeLogs.actorId,
              createdAt: changeLogs.createdAt,
            })
            .from(changeLogs)
            .where(eq(changeLogs.entityId, entity.id))
            .orderBy(asc(changeLogs.id));
        const before = await snapshot();
        const read = (caller: ReturnType<typeof makeCaller>) =>
          kind === "lead"
            ? caller.lead.leadTimeline({
                leadId: entity.id,
                locale: savedPreferences.locale,
                numberingSystem: savedPreferences.numberingSystem,
              })
            : caller.contacts.contactTimeline({
                entityType: "organization",
                entityId: entity.id,
                locale: savedPreferences.locale,
                numberingSystem: savedPreferences.numberingSystem,
              });

        const visible = await read(makeCaller(db, actor(owner.id)));
        const hidden = await read(makeCaller(db, actor(stranger.id)));

        expect(hidden.items).toEqual([]);
        expect(visible.items.map((item) => item.id).sort()).toEqual(
          before.map((row) => row.id).sort(),
        );
        for (const item of visible.items) {
          expect(item.kind).toBe("event");
          if (item.kind !== "event") throw new Error("unexpected timeline item");
          expect(item.actorName).toBe("Jörg Owner");
        }
        const eventFor = (field: string) => {
          const id = before.find((row) => row.field === field)?.id;
          const item = visible.items.find((entry) => entry.id === id);
          if (item?.kind !== "event") throw new Error(`missing audit event for ${field}`);
          return withoutIsolation(item.label);
        };
        const numericLabel = eventFor(numericField);
        expect(numericLabel).toContain(display.old);
        expect(numericLabel).toContain(display.exact);
        if (display.locale === "de") {
          expect(numericLabel).toContain(
            `${kind === "lead" ? "Betrag" : "Jahresumsatz"}: ${display.old} → ${display.exact}`,
          );
        }
        expect(eventFor(titleField)).toContain(AUTHORED_OLD);
        expect(eventFor(titleField)).toContain(EXACT);
        expect(eventFor(referenceField)).toContain(REFERENCE);
        const recorded = before.find((row) => row.field === numericField);
        expect(JSON.parse(recorded?.oldValue ?? "null")).toBe(OLD);
        expect(JSON.parse(recorded?.newValue ?? "null")).toEqual(numericNew);
        expect(await snapshot()).toEqual(before);
      });
    },
  );
});
