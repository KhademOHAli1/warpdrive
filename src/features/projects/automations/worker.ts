/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Eligibility adapted from Plane Community v1.5.0 apps/api/plane/bgtasks/issue_automation_task.py.
 */

import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_PROJECT_AUTOMATIONS } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { readInternalProjectSettings } from "../access";
import {
  internalProjectPlanningAssignments as assignments,
  internalProjectPlanningGroups as groups,
} from "../planning/schema";
import { internalProjectItems as items, internalProjectStates as states } from "../schema";
import { projectToday } from "../settings/projectTime";
import {
  internalProjectAutomationEvents as events,
  internalProjectAutomations as rules,
} from "./schema";
import { readProjectAutomationSettings } from "./service";

const batchSize = 100;
const inactiveMonthMs = 30 * 24 * 60 * 60 * 1_000;
const editableStates = ["planned", "active", "on-hold"] as const;
type Action =
  | { kind: "archived"; months: number }
  | { kind: "closed"; months: number; stateId: string };

function boundToOngoingPlan(db: Db, day: string) {
  return db
    .select({ id: assignments.groupId })
    .from(assignments)
    .innerJoin(
      groups,
      and(eq(groups.id, assignments.groupId), eq(groups.projectId, assignments.projectId)),
    )
    .where(
      and(
        eq(assignments.itemId, items.id),
        eq(assignments.projectId, items.projectId),
        or(isNull(groups.endDate), gte(groups.endDate, day)),
      ),
    );
}

async function applyAction(db: Db, projectId: string, action: Action, now: Date, today: string) {
  if (action.months === 0) return 0;
  const boundary = new Date(now.getTime() - action.months * inactiveMonthMs);
  const candidates = await db
    .select({ id: items.id })
    .from(items)
    .innerJoin(states, and(eq(states.projectId, items.projectId), eq(states.id, items.stateId)))
    .where(
      and(
        eq(items.projectId, projectId),
        isNull(items.archivedAt),
        lte(items.updatedAt, boundary),
        lt(items.revision, Number.MAX_SAFE_INTEGER),
        inArray(
          states.category,
          action.kind === "archived"
            ? ["completed", "cancelled"]
            : ["backlog", "unstarted", "started"],
        ),
        notExists(boundToOngoingPlan(db, today)),
      ),
    )
    .orderBy(asc(items.updatedAt), asc(items.id))
    .limit(batchSize);
  if (candidates.length === 0) return 0;
  const update =
    action.kind === "archived"
      ? { archivedAt: now }
      : { stateId: action.stateId, status: "done" as const };
  const changed = await db
    .update(items)
    .set({ ...update, revision: sql`${items.revision} + 1` })
    .where(
      and(
        eq(items.projectId, projectId),
        inArray(
          items.id,
          candidates.map(({ id }) => id),
        ),
      ),
    )
    .returning({ id: items.id });
  await db.insert(events).values(
    changed.map(({ id }) => ({
      projectId,
      itemId: id,
      kind: action.kind,
      recordedAt: now,
    })),
  );
  return changed.length;
}

async function drainAction(
  db: Db,
  projectId: string,
  action: Action,
  now: Date,
  today: string,
  signal: AbortSignal,
) {
  let count = 0;
  for (;;) {
    signal.throwIfAborted();
    const changed = await applyAction(db, projectId, action, now, today);
    count += changed;
    if (changed < batchSize) return count;
  }
}

async function applyProjectAutomations(db: Db, projectId: string, now: Date, signal: AbortSignal) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const [module] = await tx
      .select({ enabled: agencyProjectSettings.enabled })
      .from(agencyProjectSettings)
      .where(eq(agencyProjectSettings.id, true));
    if (module?.enabled !== true) return { archived: 0, closed: 0 };
    const [project] = await tx
      .select({ id: agencyProjects.id })
      .from(agencyProjects)
      .where(
        and(
          eq(agencyProjects.id, projectId),
          eq(agencyProjects.kind, "internal"),
          inArray(agencyProjects.state, editableStates),
        ),
      )
      .for("update");
    if (project === undefined) return { archived: 0, closed: 0 };
    const settings = await readProjectAutomationSettings(tx, projectId);
    const today = projectToday((await readInternalProjectSettings(tx, projectId)).timeZone, now);
    const archived = await drainAction(
      tx,
      projectId,
      { kind: "archived", months: settings.archiveAfterMonths },
      now,
      today,
      signal,
    );
    if (settings.closeStateId === null) return { archived, closed: 0 };
    const [target] = await tx
      .select({ id: states.id })
      .from(states)
      .where(
        and(
          eq(states.projectId, projectId),
          eq(states.id, settings.closeStateId),
          eq(states.category, "cancelled"),
        ),
      );
    if (target === undefined) return { archived, closed: 0 };
    const closed = await drainAction(
      tx,
      projectId,
      { kind: "closed", months: settings.closeAfterMonths, stateId: target.id },
      now,
      today,
      signal,
    );
    return { archived, closed };
  });
}

export async function runProjectAutomations(db: Db, now: Date, signal: AbortSignal) {
  const result = { archived: 0, closed: 0 };
  const [module] = await db
    .select({ enabled: agencyProjectSettings.enabled })
    .from(agencyProjectSettings)
    .where(eq(agencyProjectSettings.id, true));
  if (module?.enabled !== true) return result;
  let after: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    const page: { projectId: string }[] = await db
      .select({ projectId: rules.projectId })
      .from(rules)
      .where(
        and(
          or(gt(rules.archiveAfterMonths, 0), gt(rules.closeAfterMonths, 0)),
          after === undefined ? undefined : gt(rules.projectId, after),
        ),
      )
      .orderBy(asc(rules.projectId))
      .limit(batchSize);
    for (const { projectId } of page) {
      signal.throwIfAborted();
      const changed = await applyProjectAutomations(db, projectId, now, signal);
      result.archived += changed.archived;
      result.closed += changed.closed;
    }
    const last = page.at(-1);
    if (page.length < batchSize || last === undefined) return result;
    after = last.projectId;
  }
}

export async function registerProjectAutomations(boss: PgBoss, db: Db) {
  await boss.createQueue(PGBOSS_QUEUE_PROJECT_AUTOMATIONS);
  await boss.work(PGBOSS_QUEUE_PROJECT_AUTOMATIONS, async () => {
    await runProjectAutomations(db, new Date(), AbortSignal.timeout(3 * 60_000));
  });
  await boss.schedule(PGBOSS_QUEUE_PROJECT_AUTOMATIONS, "0 1 * * *", undefined, { tz: "UTC" });
}
