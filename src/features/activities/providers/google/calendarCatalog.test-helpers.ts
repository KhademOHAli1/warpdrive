import { expect, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import {
  calendarTestConfig,
  calendarTestTransport,
  connectTestCalendar,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import type { GoogleTransport } from "./contracts";

export const initialCatalogCalendar = {
  id: "team/a?b@example.invalid",
  summary: "تیم / Team",
  timeZone: "Asia/Tehran",
  accessRole: "writer",
  hidden: true,
  conferenceProperties: {
    allowedConferenceSolutionTypes: ["hangoutsMeet", "futureConference"],
  },
};

export function forbidProviderNetwork() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.reject<Response>(
        new AppError(ERROR_IDS.DB_INVARIANT, "catalog tests require synthetic provider transport"),
      ),
    );
}

export async function catalogFixture(db: Db) {
  const owner = await seedUser(db);
  const connected = await connectTestCalendar(db, owner.id);
  return { userId: owner.id, accountId: connected.accountId };
}
export type CatalogFixture = Awaited<ReturnType<typeof catalogFixture>>;

export function catalogTransport(
  pages: readonly unknown[],
  onPage?: (url: URL) => void,
): GoogleTransport {
  const tokens: GoogleTransport = calendarTestTransport({ refreshToken: null });
  let index = 0;
  return async (url, init) => {
    init.signal.throwIfAborted();
    if (url.endsWith("/token")) return tokens(url, init);
    if (!url.includes("/calendar/v3/users/me/calendarList"))
      throw new AppError(ERROR_IDS.DB_INVARIANT, "unexpected synthetic catalog endpoint");
    onPage?.(new URL(url));
    if (index >= pages.length)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "unexpected synthetic catalog page");
    const page = pages[index++];
    return page instanceof Response ? page : new Response(JSON.stringify(page));
  };
}

export async function discoverCatalog(
  db: Db,
  fixture: CatalogFixture,
  pages: readonly unknown[],
  options: { transport?: GoogleTransport; signal?: AbortSignal; now?: () => Date } = {},
) {
  const api = await import("./calendarCatalog");
  return api.discoverGoogleCalendarCatalog(
    db,
    fixture.userId,
    fixture.accountId,
    calendarTestConfig,
    options.signal ?? signal(),
    { transport: options.transport ?? catalogTransport(pages), now: options.now },
  );
}

export async function readCatalog(db: Db, fixture: CatalogFixture) {
  const api = await import("./calendarCatalog");
  const result = await api.listGoogleCalendarCatalog(
    db,
    fixture.userId,
    fixture.accountId,
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "catalog fixture read failed");
  return result.value;
}

export async function readyCatalogFixture(db: Db) {
  const fixture = await catalogFixture(db);
  const result = await discoverCatalog(db, fixture, [
    { items: [initialCatalogCalendar], nextSyncToken: "initial-catalog-cursor" },
  ]);
  expect(result.ok).toBe(true);
  return { ...fixture, catalog: await readCatalog(db, fixture) };
}
