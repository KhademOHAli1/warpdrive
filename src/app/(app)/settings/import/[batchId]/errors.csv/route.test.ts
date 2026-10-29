import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { customFieldDefs, importBatches, importRows } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { LOCALE_COOKIE, type LocalePreferences } from "@/features/i18n/preferences";
import type * as I18nServer from "@/features/i18n/server";
import type { AppContext } from "@/server/trpc/context";

// Only request identity and the viewer preference boundary are substituted. Every query below,
// including the report/definition reads, runs against the migrated disposable Postgres database.
const requestState = vi.hoisted(() => ({
  context: undefined as AppContext | undefined,
  preferences: undefined as LocalePreferences | undefined,
  cookies: new Map<string, { value: string }>(),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: () => requestState.context }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(requestState.cookies) }));
vi.mock("@/features/i18n/server", async (importOriginal) => {
  const actual = await importOriginal<typeof I18nServer>();
  return {
    ...actual,
    getLocalePreferences: () => requestState.preferences ?? actual.getLocalePreferences(),
  };
});

import { hydrateActor } from "@/server/hydrateActor";
import { GET } from "./route";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_BATCH_ID = "22222222-2222-4222-8222-222222222222";

function report(batchId = BATCH_ID): Promise<Response> {
  return GET(new NextRequest(`http://localhost/settings/import/${batchId}/errors.csv`), {
    params: Promise.resolve({ batchId }),
  });
}

afterEach(() => {
  requestState.context = undefined;
  requestState.preferences = undefined;
  requestState.cookies.clear();
});

it("exports only invalid/failed rows in the viewer's locale, preserving raw CSV and stored diagnostics", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5000));
    requestState.context = { db, actor, session: null };
    await db
      .insert(importBatches)
      .values({ id: BATCH_ID, createdBy: user.id, targetEntity: "person", filename: "people.csv" });
    const storedErrors = [{ field: "emails.0.value", message: "Invalid email address" }];
    await db.insert(importRows).values([
      {
        batchId: BATCH_ID,
        rowNumber: 12,
        status: "invalid",
        raw: { Name: "علی", Email: "=CMD" },
        errors: storedErrors,
      },
      {
        batchId: BATCH_ID,
        rowNumber: 15,
        status: "failed",
        raw: { Name: "fifteen", Email: "" },
        errors: [{ field: "_", message: "candidate vanished" }],
      },
      { batchId: BATCH_ID, rowNumber: 16, status: "valid", raw: { Name: "excluded", Email: "" } },
    ]);
    requestState.preferences = { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" };
    const fa = await report();
    expect(fa.status).toBe(200);
    expect(fa.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(fa.headers.get("content-disposition")).toBe(
      `attachment; filename="import-${BATCH_ID}-errors.csv"`,
    );
    expect(new TextDecoder().decode(await fa.arrayBuffer())).toBe(
      "row,errors,Name,Email\n12,ایمیل: یک نشانی ایمیل معتبر وارد کنید.,علی,'=CMD\n15,ردیف: این رکورد دیگر وجود ندارد.,fifteen,",
    );
    requestState.preferences = { locale: "en", calendar: "gregory", timeZone: "UTC" };
    const en = await report();
    expect(await en.text()).toBe(
      "row,errors,Name,Email\n12,Email: Enter a valid email address.,علی,'=CMD\n15,Row: This record no longer exists.,fifteen,",
    );
    const [persisted] = await db.select().from(importRows).where(eq(importRows.rowNumber, 12));
    expect(persisted?.errors).toEqual(storedErrors);
    expect(persisted?.raw).toEqual({ Name: "علی", Email: "=CMD" });
  });
});

it("keeps owner/admin and data.import gates and localized 403/404 status contracts", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const base = await hydrateActor(db, other.id, AbortSignal.timeout(5000));
    expect(base).not.toBeNull();
    if (!base) return;
    await db.insert(importBatches).values({
      id: BATCH_ID,
      createdBy: owner.id,
      targetEntity: "person",
      filename: "private.csv",
    });
    requestState.preferences = { locale: "fa", calendar: "persian", timeZone: "UTC" };
    requestState.context = { db, actor: { ...base, flags: new Set() }, session: null };
    const denied = await report();
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("اجازه دریافت گزارش خطاهای این ورود اطلاعات را ندارید.");
    requestState.context.actor = { ...base, flags: new Set(["data.import"]) };
    const hidden = await report();
    const absent = await report(MISSING_BATCH_ID);
    expect(hidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(await hidden.text()).toBe(await absent.text());
    requestState.context.actor = { ...base, type: "admin" };
    expect((await report()).status).toBe(200);
    requestState.context.actor = { ...base, id: owner.id, flags: new Set(["data.import"]) };
    expect((await report()).status).toBe(200);
  });
});

it("uses the existing signed-out locale-cookie fallback for a localized 401", async () => {
  await withTestDb(async (db) => {
    requestState.context = { db, actor: null, session: null };
    requestState.cookies.set(LOCALE_COOKIE, { value: "fa" });
    const response = await report();
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("برای دریافت گزارش خطاهای ورود اطلاعات وارد حساب خود شوید.");
  });
});

it("resolves custom diagnostic labels from current authorized metadata and hides retired keys", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db, { isAdmin: true });
    const actor = await hydrateActor(db, owner.id, AbortSignal.timeout(5000));
    requestState.context = { db, actor, session: null };
    requestState.preferences = { locale: "fa", calendar: "persian", timeZone: "UTC" };
    await db
      .insert(customFieldDefs)
      .values({ targetEntity: "person", type: "text", key: "customer_code", name: "شناسه مشتری" });
    await db.insert(importBatches).values({
      id: BATCH_ID,
      createdBy: owner.id,
      targetEntity: "person",
      filename: "people.csv",
    });
    await db.insert(importRows).values({
      batchId: BATCH_ID,
      rowNumber: 2,
      status: "invalid",
      raw: { Customer: "" },
      errors: [
        { field: "customFields.customer_code", message: "required custom field is empty" },
        { field: "customFields.retired_key", message: "historical worker internals" },
      ],
    });
    expect(await (await report()).text()).toBe(
      "row,errors,Customer\n2,شناسه مشتری: تکمیل این فیلد ضروری است.; فیلد سفارشی: مقدار واردشده معتبر نیست. قالب داده و فیلدهای ضروری را بررسی کنید.,",
    );
  });
});

it("keeps malformed route parameters at 400 and localizes their response", async () => {
  requestState.preferences = { locale: "fa", calendar: "persian", timeZone: "UTC" };
  const response = await report("invalid-id");
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("درخواست دریافت گزارش ورود اطلاعات معتبر نیست.");
});
