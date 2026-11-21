import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { internalProjectItems as items, internalProjectStates as states } from "../schema";
import { withPlanningProject } from "./access";
import { planningCyclePhase, type RolloverPlanningCycle } from "./contracts";
import {
  internalProjectPlanningAssignments as assignments,
  internalProjectPlanningGroups as groups,
} from "./schema";

const incomplete = () => inArray(states.category, ["backlog", "unstarted", "started"]);

function sourceLinks(projectId: string, sourceCycleId: string) {
  return and(
    eq(assignments.projectId, projectId),
    eq(assignments.groupId, sourceCycleId),
    eq(assignments.kind, "cycles"),
  );
}

export function rolloverPlanningCycle(
  db: Db,
  session: NativeSessionRef,
  input: RolloverPlanningCycle,
  signal: AbortSignal,
) {
  const { projectId, sourceCycleId, targetCycleId } = input;
  return withPlanningProject(db, session, projectId, "write", signal, async (tx) => {
    if (sourceCycleId === targetCycleId) return err("project_invalid");
    const cycles = await tx
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.projectId, projectId),
          eq(groups.kind, "cycles"),
          isNull(groups.archivedAt),
          inArray(groups.id, [sourceCycleId, targetCycleId]),
        ),
      );
    const source = cycles.find(({ id }) => id === sourceCycleId);
    const target = cycles.find(({ id }) => id === targetCycleId);
    if (source === undefined || target === undefined) return err("project_unavailable");
    const today = new Date().toISOString().slice(0, 10);
    if (
      planningCyclePhase(source, today) !== "completed" ||
      planningCyclePhase(target, today) === "completed"
    )
      return err("project_invalid");

    const matchingState = and(eq(states.projectId, items.projectId), eq(states.id, items.stateId));
    const matchingItem = and(
      eq(items.id, assignments.itemId),
      eq(items.projectId, projectId),
      isNull(items.archivedAt),
    );
    const [counts] = await tx
      .select({
        itemCount: count(items.id),
        closedCount: count(sql`CASE WHEN NOT ${incomplete()} THEN ${items.id} END`),
      })
      .from(assignments)
      .innerJoin(items, matchingItem)
      .innerJoin(states, matchingState)
      .where(sourceLinks(projectId, sourceCycleId));
    if (counts === undefined || counts.itemCount === counts.closedCount)
      return ok({ movedCount: 0 });

    const transferable = tx
      .select({ id: items.id })
      .from(items)
      .innerJoin(states, matchingState)
      .where(and(eq(items.projectId, projectId), isNull(items.archivedAt), incomplete()));
    const moved = await tx
      .update(assignments)
      .set({ groupId: targetCycleId })
      .where(and(sourceLinks(projectId, sourceCycleId), inArray(assignments.itemId, transferable)));
    const movedCount = moved.rowCount ?? 0;
    if (movedCount > 0) {
      await tx
        .update(groups)
        .set({
          rolloverSnapshot: {
            ...counts,
            movedCount,
            targetCycleId,
            recordedAt: new Date().toISOString(),
          },
        })
        .where(
          and(
            eq(groups.id, sourceCycleId),
            eq(groups.projectId, projectId),
            eq(groups.kind, "cycles"),
          ),
        );
    }
    return ok({ movedCount });
  });
}
