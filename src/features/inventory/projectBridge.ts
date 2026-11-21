import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nativeProjectOwner } from "@/features/agency-projects/nativeAccess";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import { isEligibleProjectMember, lockInternalProject } from "@/features/projects/access";
import { createProjectItemInput } from "@/features/projects/input";
import { internalProjectItems, internalProjectStates } from "@/features/projects/schema";
import { createInternalProjectItemInTransaction } from "@/features/projects/service";
import {
  findProjectWorkflowState,
  readProjectWorkflowStates,
} from "@/features/projects/settings/states";
import type { HydratedActor } from "@/server/hydrateActor";
import type { InventoryTemplate } from "./contracts";
import { InventoryDomainError } from "./errors";
import { inventoryOrderTasks } from "./schema";

type ProductionStep = InventoryTemplate["steps"][number];

export async function inventoryProjectsEnabled(tx: Db): Promise<boolean> {
  const [settings] = await tx
    .select({ enabled: agencyProjectSettings.enabled })
    .from(agencyProjectSettings)
    .where(eq(agencyProjectSettings.id, true));
  return settings?.enabled === true;
}

async function writableProductionProject(
  tx: Db,
  actor: HydratedActor,
  projectId: string,
  mode: "read" | "write",
  signal: AbortSignal,
) {
  if (actor.type !== "admin" || !(await inventoryProjectsEnabled(tx))) {
    throw new InventoryDomainError("The production project is unavailable.");
  }
  const result = await lockInternalProject(tx, actor, projectId, mode);
  signal.throwIfAborted();
  if (!result.ok || result.value.summary.archived || !result.value.canAssign) {
    throw new InventoryDomainError(
      "The production project needs current project assignment access.",
    );
  }
  const states = await readProjectWorkflowStates(tx, projectId);
  if (findProjectWorkflowState(states, undefined, "todo") === undefined) {
    throw new InventoryDomainError("The production project needs an open workflow state.");
  }
  return result.value;
}

function nativeProductionStep(
  projectId: string,
  id: string,
  step: ProductionStep,
  orderId?: string,
  standalone = false,
) {
  const parsed = createProjectItemInput.safeParse({
    projectId,
    id,
    title: step.title,
    assigneeId: step.assigneeId,
    status: "todo",
    ...(orderId === undefined || standalone ? {} : { description: `Production order: ${orderId}` }),
  });
  if (!parsed.success || parsed.data.assigneeId == null)
    throw new InventoryDomainError("Check the production step title and assignee.");
  return { ...parsed.data, assigneeId: parsed.data.assigneeId };
}

export async function checkInventoryProductionTemplate(
  tx: Db,
  actor: HydratedActor,
  { projectId, steps }: InventoryTemplate,
  signal: AbortSignal,
): Promise<void> {
  const project = await writableProductionProject(tx, actor, projectId, "read", signal);
  const assignees = new Set<string>();
  for (const step of steps) {
    const input = nativeProductionStep(projectId, projectId, step);
    assignees.add(input.assigneeId);
  }
  for (const userId of assignees) {
    if (!(await isEligibleProjectMember(tx, project, userId))) {
      throw new InventoryDomainError("Choose an active project member for each production step.");
    }
  }
}

function productionStepIntent(orderId: string, position: number): string {
  const hash = createHash("sha256").update(`warpdrive-inventory/${orderId}/${position}`).digest();
  hash[6] = (hash.readUInt8(6) & 15) | 128;
  hash[8] = (hash.readUInt8(8) & 63) | 128;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function createInventoryProjectTasks(
  tx: Db,
  actorId: string,
  template: InventoryTemplate & { configuredBy: string },
  signal: AbortSignal,
  orderId: string,
  standalone = false,
): Promise<string[]> {
  const { projectId, configuredBy, steps } = template;
  const delegation = await nativeProjectOwner(tx, configuredBy, signal);
  if (delegation === null)
    throw new InventoryDomainError("The production template needs an authorized administrator.");
  const access = await writableProductionProject(tx, delegation.actor, projectId, "write", signal);
  const ids: string[] = [];
  // One project lock covers all native item writes. Each created event attributes the seller.
  for (const [position, step] of steps.entries()) {
    signal.throwIfAborted();
    const input = nativeProductionStep(
      projectId,
      productionStepIntent(orderId, position),
      step,
      orderId,
      standalone,
    );
    const created = await createInternalProjectItemInTransaction(tx, access, actorId, input);
    if (!created.ok)
      throw new InventoryDomainError(
        "The production template no longer has valid project steps and assignees.",
      );
    ids.push(created.value.itemId);
  }
  return ids;
}

export async function readInventoryProjectTaskRows(tx: Db, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return tx
    .select({
      orderId: inventoryOrderTasks.orderId,
      projectId: inventoryOrderTasks.projectId,
      id: internalProjectItems.id,
      title: internalProjectItems.title,
      createdBy: internalProjectItems.createdBy,
      category: internalProjectStates.category,
    })
    .from(inventoryOrderTasks)
    .innerJoin(
      internalProjectItems,
      and(
        eq(internalProjectItems.id, inventoryOrderTasks.itemId),
        eq(internalProjectItems.projectId, inventoryOrderTasks.projectId),
      ),
    )
    .leftJoin(
      internalProjectStates,
      and(
        eq(internalProjectStates.id, internalProjectItems.stateId),
        eq(internalProjectStates.projectId, inventoryOrderTasks.projectId),
      ),
    )
    .where(inArray(inventoryOrderTasks.orderId, orderIds))
    .orderBy(asc(inventoryOrderTasks.orderId), asc(inventoryOrderTasks.position));
}

export async function verifyInventoryTasksComplete(
  tx: Db,
  actor: HydratedActor,
  orderId: string,
  projectId: string,
  signal: AbortSignal,
): Promise<void> {
  if (!(await inventoryProjectsEnabled(tx))) {
    throw new InventoryDomainError("The production project is unavailable.");
  }
  const access = await lockInternalProject(tx, actor, projectId, "read", "work-items");
  if (!access.ok) throw new InventoryDomainError("The production project is unavailable.");
  const tasks = await readInventoryProjectTaskRows(tx, [orderId]);
  signal.throwIfAborted();
  const creator = access.value.workItemCreatorId;
  if (
    tasks.length === 0 ||
    tasks.some(
      (task) =>
        task.projectId !== projectId ||
        task.category !== "completed" ||
        (creator !== null && task.createdBy !== creator),
    )
  ) {
    throw new InventoryDomainError("Complete every production task before confirming the build.");
  }
}
