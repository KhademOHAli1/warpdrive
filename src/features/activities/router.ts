import { TRPCError } from "@trpc/server";
import { asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_DAILY_ACTIVITY_TARGET } from "@/constants/activityLoad";
import { activityTypes } from "@/db/schema";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { activityAccountPreferences } from "./accountTimeZone";
import { listActivityRows } from "./activityRows";
import { getBusyWindows } from "./availability";
import { calendarRange } from "./calendar";
import { getDayLoad } from "./dayLoad";
import { listActivitiesForEntity } from "./forEntity";
import { getActivityForEdit } from "./getForEdit";
import { nextActionQueueProcedure } from "./nextActionQueueProcedure";
import { activityListFilter, activitySortInput } from "./schemas";

// listRows' input: the list filter (every field defaulted, so an empty call still resolves to
// the default "open" view) plus an optional sort (still separate from the filter's own shape,
// since ActivityListFilter is also the exact type listActivityRows and its tests expect).
const listRowsInput = activityListFilter.extend({
  sort: activitySortInput.optional(),
  timeZone: z.string().optional(),
});

export const activitiesRouter = router({
  nextActionQueue: nextActionQueueProcedure,
  // All visible activities enriched for the Activities table (deal/contact/org/priority).
  listRows: protectedProcedure.input(listRowsInput).query(async ({ ctx, input }) => {
    const { sort, timeZone, ...filter } = input;
    const prefs = await activityAccountPreferences(ctx.db, ctx.actor.id, { timeZone });
    return listActivityRows(
      ctx.db,
      ctx.actor,
      filter,
      AbortSignal.timeout(10_000),
      sort,
      prefs.timeZone,
    );
  }),

  // Activity type catalog for the create modal (call/meeting/task/deadline/email/lunch).
  // Only active (non-archived) types are offered when creating an activity.
  listTypes: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: activityTypes.id,
        key: activityTypes.key,
        name: activityTypes.name,
        isSystem: activityTypes.isSystem,
      })
      .from(activityTypes)
      .where(isNull(activityTypes.archivedAt))
      .orderBy(asc(activityTypes.order)),
  ),

  // calendarRange returns CalendarActivity[] (not a Result); no unwrap needed.
  // Client sends ISO datetime strings; convert to Date before the repo call.
  calendarRange: protectedProcedure
    .input(
      z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        timeZone: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const prefs = await activityAccountPreferences(ctx.db, ctx.actor.id, {
        timeZone: input.timeZone,
      });
      return calendarRange(
        ctx.db,
        ctx.actor,
        { from: new Date(input.from), to: new Date(input.to) },
        AbortSignal.timeout(10_000),
        prefs.timeZone,
      );
    }),

  listForEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(["deal", "person", "organization"]),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      listActivitiesForEntity(
        ctx.db,
        ctx.actor,
        input.entityType,
        input.entityId,
        AbortSignal.timeout(10_000),
      ),
    ),

  // Full activity (incl. guest/participant sets) for prefilling the inline edit composer.
  // Visibility-gated in getActivityForEdit; NOT_FOUND on missing/invisible so nothing leaks.
  getForEdit: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const r = await getActivityForEdit(ctx.db, ctx.actor, input.id, AbortSignal.timeout(10_000));
      if (!r.ok) throw new TRPCError({ code: "NOT_FOUND", message: r.error.id });
      return r.value;
    }),

  // Read-only Free/Busy signal for the composer: is the assignee already booked in [from, to]?
  // Defaults the assignee to the current actor. Returns a coarse boolean, never activity details.
  availability: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid().nullable().default(null),
        from: z.string().datetime(),
        to: z.string().datetime(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const prefs = await activityAccountPreferences(ctx.db, ctx.actor.id);
      const windows = await getBusyWindows(
        ctx.db,
        {
          userId: input.userId ?? ctx.actor.id,
          timeZone: prefs.timeZone,
          from: new Date(input.from),
          to: new Date(input.to),
        },
        AbortSignal.timeout(10_000),
      );
      return { busy: windows.length > 0 };
    }),

  dayLoad: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid().nullable().default(null),
        from: z.string().datetime(),
        to: z.string().datetime(),
        timeZone: z.string().min(1).default("UTC"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.actor.id;
      const viewer = await activityAccountPreferences(ctx.db, ctx.actor.id, {
        timeZone: input.timeZone,
      });
      const [counts, prefs] = await Promise.all([
        getDayLoad(
          ctx.db,
          {
            userId,
            from: new Date(input.from),
            to: new Date(input.to),
            timeZone: viewer.timeZone,
          },
          AbortSignal.timeout(10_000),
        ),
        getPreferencesForActor(ctx.db, userId),
      ]);
      return { counts, target: prefs.ui.dailyActivityTarget ?? DEFAULT_DAILY_ACTIVITY_TARGET };
    }),
});
