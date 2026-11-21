import { z } from "zod";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { changePlanningGroupItems } from "../planning/assignments";
import {
  type PlanningGroup,
  type PlanningGroupKind,
  planningModuleStatuses,
  savePlanningGroupInput,
} from "../planning/contracts";
import {
  listPlanningGroups,
  readPlanningGroup,
  savePlanningGroup,
  setPlanningGroupArchive,
} from "../planning/groups";
import { rolloverPlanningCycle } from "../planning/rollover";
import {
  apiJson,
  apiPage,
  body,
  intent,
  methodNotAllowed,
  missing,
  parsed,
  returned,
} from "./httpSupport";
import { type Operation, workspace } from "./operations";
import { planningDto, workItemDto } from "./wire";

const details = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  start_date: z.iso.date().nullish(),
  end_date: z.iso.date().nullish(),
  target_date: z.iso.date().nullish(),
  status: z.enum(planningModuleStatuses).optional(),
});

export async function projectPlanning(
  op: Operation,
  projectId: string,
  kind: PlanningGroupKind,
  groupId?: string,
  mode?: "archive" | "unarchive",
  archivedOnly = false,
) {
  const method = op.request.method;
  if (groupId === undefined && method === "GET") {
    const listing = returned(await listPlanningGroups(op.db, op.actor, projectId, kind, op.signal));
    return apiPage(
      op.url,
      listing.groups
        .filter((group) => group.archived === archivedOnly)
        .map((group) => planningDto(projectId, group)),
    );
  }
  const current =
    groupId === undefined
      ? undefined
      : returned(await readPlanningGroup(op.db, op.actor, { projectId, kind, groupId }, op.signal))
          .group;
  if (archivedOnly && current?.archived !== true) return missing();
  if (current !== undefined) {
    if (mode === undefined && method === "GET") return apiJson(planningDto(projectId, current));
    if (method === "DELETE" || (method === "POST" && mode !== undefined)) {
      return archivePlanning(op, projectId, kind, current, mode !== "unarchive");
    }
  }
  if (mode !== undefined || (current === undefined ? method !== "POST" : method !== "PATCH"))
    return methodNotAllowed();
  return writePlanning(op, projectId, kind, current);
}

async function archivePlanning(
  op: Operation,
  projectId: string,
  kind: PlanningGroupKind,
  current: PlanningGroup,
  archived: boolean,
) {
  const next = returned(
    await setPlanningGroupArchive(
      op.db,
      op.actor,
      {
        projectId,
        kind,
        groupId: current.id,
        revision: current.revision,
        archived,
        expectedActorId: op.actor.userId,
        csrfToken: null,
      },
      op.signal,
    ),
  );
  return op.request.method === "DELETE"
    ? apiJson(undefined, 204)
    : apiJson(planningDto(projectId, next));
}

async function writePlanning(
  op: Operation,
  projectId: string,
  kind: PlanningGroupKind,
  current: PlanningGroup | undefined,
) {
  const change = parsed(details, await body(op.request, op.signal));
  const endDate = change.end_date === undefined ? change.target_date : change.end_date;
  const input = parsed(savePlanningGroupInput, {
    projectId,
    groupId: current?.id ?? intent(op.request),
    kind,
    revision: current?.revision ?? null,
    title: change.name ?? current?.title,
    description: change.description ?? current?.description ?? "",
    startDate: change.start_date === undefined ? (current?.startDate ?? null) : change.start_date,
    endDate: endDate === undefined ? (current?.endDate ?? null) : endDate,
    moduleStatus: kind === "cycles" ? null : (change.status ?? current?.moduleStatus ?? "backlog"),
    expectedActorId: op.actor.userId,
    csrfToken: null,
  });
  const saved = returned(await savePlanningGroup(op.db, op.actor, input, op.signal));
  return apiJson(planningDto(projectId, saved), current === undefined ? 201 : 200);
}

export async function planningWorkItems(
  op: Operation,
  projectId: string,
  kind: PlanningGroupKind,
  groupId: string,
  itemId?: string,
) {
  const method = op.request.method;
  if (method === "GET") {
    const group = returned(
      await readPlanningGroup(op.db, op.actor, { projectId, kind, groupId }, op.signal),
    );
    const included = new Set(group.items.filter((item) => item.included).map((item) => item.id));
    const items = (await workspace(op, projectId)).items.filter((item) => included.has(item.id));
    if (itemId !== undefined)
      return apiJson(workItemDto(projectId, items.find((item) => item.id === itemId) ?? missing()));
    return apiPage(
      op.url,
      items.map((item) => workItemDto(projectId, item)),
    );
  }
  if (
    !(method === "POST" && itemId === undefined) &&
    !(method === "DELETE" && itemId !== undefined)
  )
    return methodNotAllowed();
  const ids =
    itemId === undefined
      ? parsed(
          z.strictObject({ issues: z.array(z.uuid()).min(1).max(50) }),
          await body(op.request, op.signal),
        ).issues
      : [itemId];
  return withCurrentAuthority(op.db, "read", op.signal, async (tx) => {
    for (const id of new Set(ids))
      returned(
        await changePlanningGroupItems(
          tx,
          op.actor,
          {
            projectId,
            kind,
            groupId,
            itemId: id,
            included: method === "POST",
            expectedActorId: op.actor.userId,
            csrfToken: null,
          },
          op.signal,
        ),
      );
    return apiJson(undefined, 204);
  });
}

export async function transferCycleItems(op: Operation, projectId: string, sourceCycleId: string) {
  if (op.request.method !== "POST") return methodNotAllowed();
  const input = parsed(
    z.strictObject({ new_cycle_id: z.uuid() }),
    await body(op.request, op.signal),
  );
  const transfer = returned(
    await rolloverPlanningCycle(
      op.db,
      op.actor,
      {
        projectId,
        sourceCycleId,
        targetCycleId: input.new_cycle_id,
        expectedActorId: op.actor.userId,
        csrfToken: null,
      },
      op.signal,
    ),
  );
  return apiJson({ message: "Success", moved_count: transfer.movedCount });
}
