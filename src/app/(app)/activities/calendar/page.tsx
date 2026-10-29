import { redirect } from "next/navigation";
import { calendarRange } from "@/features/activities/calendar";
import { CALENDAR_MESSAGES } from "@/features/activities/calendarMessages";
import { parseCalendarParams, selectWindow } from "@/features/activities/calendarView";
import { getLocalePreferences } from "@/features/i18n/server";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { createContext } from "@/server/trpc/context";
import { ActivitiesToggle } from "../ActivitiesToggle";
import { FilterableCalendar } from "./FilterableCalendar";

export async function generateMetadata(): Promise<{ title: string }> {
  const preferences = await getLocalePreferences();
  return { title: CALENDAR_MESSAGES[preferences.locale].title };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }

  const sp = await searchParams;
  const preferences = await getLocalePreferences();
  const { view, anchorIso } = parseCalendarParams(
    {
      view: typeof sp.view === "string" ? sp.view : undefined,
      d: typeof sp.d === "string" ? sp.d : undefined,
    },
    new Date(),
    preferences.timeZone,
  );
  const { days, range } = selectWindow(view, anchorIso, preferences);
  const activities = await calendarRange(
    ctx.db,
    ctx.actor,
    range,
    AbortSignal.timeout(10_000),
    preferences.timeZone,
  );

  return (
    <div className="p-4">
      {/* The screen's own name. The toggle and the week label read as controls without it, and the
          page had no heading of any level for a screen reader to land on. */}
      <h1 className="sr-only">{CALENDAR_MESSAGES[preferences.locale].title}</h1>
      <ActivitiesToggle active="calendar" />
      <FilterableCalendar
        view={view}
        anchorIso={anchorIso}
        dayIsos={days.map((d) => d.toISOString().slice(0, 10))}
        activities={activities}
        initialTodayIso={instantCivilDate(new Date(), preferences.timeZone)}
      />
    </div>
  );
}
