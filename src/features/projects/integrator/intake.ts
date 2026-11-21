import { z } from "zod";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { ProjectIntakeFilter } from "../intake/contracts";
import {
  createProjectIntakeInput,
  reviewProjectIntakeInput,
  updateProjectIntakeInput,
} from "../intake/input";
import {
  createProjectIntake,
  readProjectIntake,
  reviewProjectIntake,
  updateProjectIntake,
  withdrawProjectIntake,
} from "../intake/service";
import {
  apiJson,
  body,
  intent,
  methodNotAllowed,
  missing,
  ProjectApiError,
  parsed,
  returned,
} from "./httpSupport";
import type { Operation } from "./operations";
import { intakeDto } from "./wire";
import { workDescription } from "./workItems";

const statuses: Record<string, ProjectIntakeFilter> = {
  "-2": "pending",
  "-1": "declined",
  "0": "snoozed",
  "1": "accepted",
  "2": "duplicate",
  all: "all",
};
const issueInput = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  description_html: z.string().max(32_000).optional(),
  priority: createProjectIntakeInput.shape.priority.optional(),
});
const requestInput = z.strictObject({
  issue: issueInput.optional(),
  status: z
    .union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])
    .optional(),
  state_id: z.uuid().optional(),
  snoozed_till: z.iso.datetime({ offset: true }).optional(),
  duplicate_to: z.uuid().optional(),
});

async function intake(
  op: Operation,
  projectId: string,
  filter: ProjectIntakeFilter,
  requestId?: string,
  page = 1,
) {
  const result = returned(
    await readProjectIntake(op.db, op.actor, { projectId, filter, requestId, page }, op.signal),
  );
  if (!result.enabled) return missing();
  return result;
}

async function detail(op: Operation, projectId: string, id: string) {
  return (await intake(op, projectId, "all", id)).selected ?? missing();
}

function publication(
  input: z.output<typeof issueInput>,
  current?: { title: string; description: string; priority: string },
) {
  return {
    title: input.name ?? current?.title,
    priority: input.priority ?? current?.priority ?? "none",
    description:
      input.description ??
      (input.description_html === undefined
        ? (current?.description ?? "")
        : workDescription(input.description_html)),
  };
}

export async function intakeCollection(op: Operation, projectId: string) {
  if (op.request.method === "GET") {
    const requested = op.url.searchParams.get("status") ?? "-2";
    const filter = Object.hasOwn(statuses, requested) ? statuses[requested] : undefined;
    const cursor = op.url.searchParams.get("cursor");
    const match = cursor === null ? null : /^50\.(\d{1,3})\.[01]$/.exec(cursor);
    if (filter === undefined || (cursor !== null && match === null))
      throw new ProjectApiError(400, "invalid_page");
    const page = match === null ? 1 : Number(match[1]) + 1;
    const listing = await intake(op, projectId, filter, undefined, page);
    return apiJson({
      results: listing.requests.map((request) => intakeDto(projectId, request)),
      next_cursor: listing.nextPage === null ? null : `50.${listing.nextPage - 1}.0`,
      prev_cursor: page <= 1 ? null : `50.${page - 2}.1`,
      next_page_results: listing.nextPage !== null,
      prev_page_results: page > 1,
      count: listing.requests.length,
    });
  }
  if (op.request.method !== "POST") return methodNotAllowed();
  const input = parsed(z.strictObject({ issue: issueInput }), await body(op.request, op.signal));
  const command = parsed(createProjectIntakeInput, {
    projectId,
    intentId: intent(op.request),
    ...publication(input.issue),
    expectedActorId: op.actor.userId,
    csrfToken: null,
  });
  const result = returned(await createProjectIntake(op.db, op.actor, command, op.signal));
  const request = await detail(op, projectId, result.id);
  return apiJson(intakeDto(projectId, request, request.description), 201);
}

function decision(input: z.output<typeof requestInput>) {
  switch (input.status) {
    case -2:
      return { action: "unsnooze" };
    case -1:
      return { action: "decline" };
    case 0:
      return { action: "snooze", until: input.snoozed_till };
    case 1:
      return { action: "accept", stateId: input.state_id };
    case 2:
      return { action: "duplicate", workItemId: input.duplicate_to };
    case undefined:
      return null;
  }
}

export async function intakeDetail(op: Operation, projectId: string, requestId: string) {
  const current = await detail(op, projectId, requestId);
  const method = op.request.method;
  const target = { projectId, requestId, revision: current.revision };
  if (method === "GET") return apiJson(intakeDto(projectId, current, current.description));
  if (method === "DELETE") {
    returned(await withdrawProjectIntake(op.db, op.actor, target, op.signal));
    return apiJson(undefined, 204);
  }
  if (method !== "PATCH") return methodNotAllowed();
  const raw = parsed(requestInput, await body(op.request, op.signal));
  const outcome = decision(raw);
  if (outcome === null && raw.issue === undefined) throw new ProjectApiError(400, "invalid_input");
  return withCurrentAuthority(op.db, "read", op.signal, async (db) => {
    const authority = { expectedActorId: op.actor.userId, csrfToken: null };
    let revision = target.revision;
    if (raw.issue !== undefined) {
      const change = parsed(updateProjectIntakeInput, {
        ...target,
        ...authority,
        ...publication(raw.issue, current),
      });
      returned(await updateProjectIntake(db, op.actor, change, op.signal));
      revision += 1;
    }
    if (outcome !== null) {
      const change = parsed(reviewProjectIntakeInput, {
        ...target,
        ...authority,
        ...outcome,
        revision,
      });
      returned(await reviewProjectIntake(db, op.actor, change, op.signal));
    }
    const after = await detail({ ...op, db }, projectId, requestId);
    return apiJson(intakeDto(projectId, after, after.description));
  });
}
