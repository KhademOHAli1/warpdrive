import { z } from "zod";
import { projectStateCategories } from "../contracts";
import { saveProjectStatesInput, setProjectMemberInput } from "../input";
import { setInternalProjectMember } from "../service";
import { saveInternalProjectStates } from "../settings/service";
import type { ProjectLabel } from "../work-structure/contracts";
import { saveProjectLabels } from "../work-structure/labels";
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
import { type Operation, projectCatalog } from "./operations";
import { labelDto, stateDto } from "./wire";

const stateInput = z.strictObject({
  name: z.string().optional(),
  group: z.enum(projectStateCategories).optional(),
  color: z.string().optional(),
  default: z.boolean().optional(),
  sequence: z.int().optional(),
});

export async function projectStates(op: Operation, projectId: string, id?: string) {
  const current = await projectCatalog(op, projectId);
  const existing =
    id === undefined ? undefined : (current.states.find((state) => state.id === id) ?? missing());
  if (op.request.method === "GET")
    return existing === undefined
      ? apiPage(
          op.url,
          current.states.map((row) => stateDto(projectId, row)),
        )
      : apiJson(stateDto(projectId, existing));
  const removing = op.request.method === "DELETE" && existing !== undefined;
  const adding = op.request.method === "POST" && existing === undefined;
  if (!adding && !removing && !(op.request.method === "PATCH" && existing !== undefined))
    return methodNotAllowed();
  const target = existing?.id ?? intent(op.request);
  const other = current.states.filter((row) => row.id !== target);
  const change = removing ? undefined : parsed(stateInput, await body(op.request, op.signal));
  const replacement =
    change === undefined
      ? []
      : [
          {
            id: target,
            name: change.name ?? existing?.name,
            category: change.group ?? existing?.category ?? "unstarted",
            position: change.sequence ?? existing?.position ?? current.states.length,
            color: change.color ?? existing?.color ?? "#6b7280",
            isDefault: change.default ?? existing?.isDefault ?? false,
          },
        ];
  const rest =
    change?.default === true ? other.map((row) => ({ ...row, isDefault: false })) : other;
  const command = parsed(saveProjectStatesInput, {
    projectId,
    revision: current.settings.revision,
    states: [...rest, ...replacement],
  });
  const saved = returned(await saveInternalProjectStates(op.db, op.actor, command, op.signal));
  if (removing) return apiJson(undefined, 204);
  return apiJson(
    stateDto(projectId, saved.states.find((row) => row.id === target) ?? missing()),
    adding ? 201 : 200,
  );
}

const labelInput = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  parent: z.uuid().nullish(),
  is_group: z.boolean().optional(),
  sort_order: z.int().optional(),
});

function replacementLabel(
  id: string,
  change: z.output<typeof labelInput>,
  previous: ProjectLabel | undefined,
  position: number,
): ProjectLabel {
  const kind =
    change.is_group === undefined
      ? (previous?.kind ?? "label")
      : change.is_group
        ? "group"
        : "label";
  return {
    id,
    name: change.name ?? previous?.name ?? "",
    description: change.description ?? previous?.description ?? "",
    color: change.color ?? previous?.color ?? "#6b7280",
    parentId: change.parent === undefined ? (previous?.parentId ?? null) : change.parent,
    kind,
    position: change.sort_order ?? previous?.position ?? position,
  };
}

export async function projectLabels(op: Operation, projectId: string, id?: string) {
  const { workStructure } = await projectCatalog(op, projectId);
  const { labels, revision } = workStructure;
  const existing =
    id === undefined ? undefined : (labels.find((label) => label.id === id) ?? missing());
  const method = op.request.method;
  if (method === "GET")
    return existing === undefined
      ? apiPage(
          op.url,
          labels.map((row) => labelDto(projectId, row)),
        )
      : apiJson(labelDto(projectId, existing));
  const removing = method === "DELETE" && existing !== undefined;
  const adding = method === "POST" && existing === undefined;
  if (!removing && !adding && !(method === "PATCH" && existing !== undefined))
    return methodNotAllowed();
  const target = existing?.id ?? intent(op.request);
  const other = labels.filter((row) => row.id !== target);
  const change = removing ? undefined : parsed(labelInput, await body(op.request, op.signal));
  const replacement =
    change === undefined ? [] : [replacementLabel(target, change, existing, labels.length)];
  const saved = returned(
    await saveProjectLabels(
      op.db,
      op.actor,
      { projectId, revision, labels: [...other, ...replacement] },
      op.signal,
    ),
  );
  if (removing) return apiJson(undefined, 204);
  return apiJson(
    labelDto(projectId, saved.labels.find((row) => row.id === target) ?? missing()),
    adding ? 201 : 200,
  );
}

const membership = z.strictObject({
  member: z.uuid().optional(),
  role: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  can_assign: z.boolean().default(false),
});

export async function projectMembers(op: Operation, projectId: string, id?: string) {
  const current = await projectCatalog(op, projectId);
  const members = [
    {
      id: current.project.owner.id,
      member: current.project.owner.id,
      display_name: current.project.owner.name,
      role: 20,
      can_assign: true,
    },
    ...current.members.map(({ person, role, canAssign }) => ({
      id: person.id,
      member: person.id,
      display_name: person.name,
      role: role === "editor" ? 15 : role === "viewer" ? 10 : 5,
      can_assign: canAssign,
    })),
  ];
  const method = op.request.method;
  if (method === "GET")
    return id === undefined
      ? apiPage(op.url, members)
      : apiJson(members.find((row) => row.id === id) ?? missing());
  if (method === "DELETE" && id !== undefined) {
    const command = parsed(setProjectMemberInput, { projectId, userId: id, membership: null });
    returned(await setInternalProjectMember(op.db, op.actor, command, op.signal));
    return apiJson(undefined, 204);
  }
  if (!(method === "POST" && id === undefined) && !(method === "PATCH" && id !== undefined))
    return methodNotAllowed();
  const data = parsed(membership, await body(op.request, op.signal));
  if (id !== undefined && data.member !== undefined && id !== data.member) return missing();
  const userId = id ?? data.member;
  const roles = { 5: "guest", 10: "viewer", 15: "editor" } as const;
  const command = parsed(setProjectMemberInput, {
    projectId,
    userId,
    membership: { role: roles[data.role], canAssign: data.can_assign },
  });
  returned(await setInternalProjectMember(op.db, op.actor, command, op.signal));
  return apiJson(
    { id: command.userId, member: command.userId, role: data.role, can_assign: data.can_assign },
    method === "POST" ? 201 : 200,
  );
}
