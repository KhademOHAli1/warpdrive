import type { AuthUser } from "@/features/permissions/types";
import type { ProjectAction, ProjectSnapshot, ProjectState } from "./projectLifecycle";

export type LocalAction =
  | ProjectAction
  | "read"
  | "edit-content"
  | "manage-members"
  | "transfer-owner";
type Membership = {
  projectId: string;
  userId: string;
  projectEdit: boolean;
  assignmentCoordinate: boolean;
};
export type LocalContext = {
  actor: Pick<AuthUser, "id" | "type" | "isActive">;
  projectId: string;
  ownerUserId: string;
  membership: Membership | null;
};
export type Relation = "owner" | "read" | "edit" | "coordinate" | "both" | "outsider";
export const actorTypes = ["regular", "admin"] as const;
export const relations: Relation[] = ["owner", "read", "edit", "coordinate", "both", "outsider"];
export const states: ProjectState[] = [
  "planned",
  "active",
  "on-hold",
  "completed",
  "canceled",
  "archived",
];
export const unarchivedStates = ["planned", "active", "on-hold", "completed", "canceled"] as const;
export const lifecycleActions: ProjectAction[] = [
  "start",
  "hold",
  "resume",
  "complete",
  "cancel",
  "archive",
  "restore",
  "reopen",
];
export const actions: LocalAction[] = [
  "read",
  "edit-content",
  ...lifecycleActions,
  "manage-members",
  "transfer-owner",
];
export const granted = { ok: true, value: true } as const;
export const denied = { ok: false, error: "project_local_access_denied" } as const;
export const contentDenied = { ok: false, error: "project_content_not_editable" } as const;
export const expectedStartResult = {
  ok: true,
  value: {
    next: { state: "active", revision: 8, archivedFrom: null },
    receipt: {
      policyVersion: 1,
      action: "start",
      from: "planned",
      to: "active",
      previousRevision: 7,
      revision: 8,
      reason: "هماهنگی / Abstimmung",
    },
  },
} as const;
export const actorId = "abcdefab-1234-4abc-8def-1234567890ab";
export const otherUserId = "bcdefabc-2345-4bcd-9efa-234567890abc";
export const projectId = "cdefabcd-3456-4cde-abcd-345678901abc";
export const otherProjectId = "defabcde-4567-4def-bcde-456789012abc";
export const inactiveOwnerId = "efabcdef-5678-4efa-cdef-567890123abc";

export function membership(projectEdit = false, assignmentCoordinate = false): Membership {
  return { projectId, userId: actorId, projectEdit, assignmentCoordinate };
}

export function context(type: AuthUser["type"], relation: Relation): LocalContext {
  return {
    actor: { id: actorId, type, isActive: true },
    projectId,
    ownerUserId: relation === "owner" ? actorId : otherUserId,
    membership:
      relation === "owner" || relation === "outsider"
        ? null
        : membership(
            relation === "edit" || relation === "both",
            relation === "coordinate" || relation === "both",
          ),
  };
}

export function snapshot(
  state: ProjectState = "planned",
  revision = 7,
  archivedFrom: Exclude<ProjectState, "archived"> = "completed",
): ProjectSnapshot {
  return { state, revision, archivedFrom: state === "archived" ? archivedFrom : null };
}

const allowed: Record<Relation, readonly LocalAction[]> = {
  owner: actions,
  read: ["read"],
  edit: ["read", "edit-content", "start", "hold", "resume", "complete"],
  coordinate: ["read"],
  both: ["read", "edit-content", "start", "hold", "resume", "complete"],
  outsider: [],
};
export function expectedAccess(relation: Relation, action: LocalAction) {
  return allowed[relation].includes(action) ? granted : denied;
}
export function expectedCoordinate(relation: Relation): boolean {
  return relation === "owner" || relation === "coordinate" || relation === "both";
}

export const relationRows = actorTypes.flatMap((type) =>
  relations.map((relation) => [type, relation] as const),
);
export const editableRows = actorTypes.flatMap((type) =>
  (["owner", "edit", "both"] as const).map((relation) => [type, relation] as const),
);
export const wrongMemberships = [
  { ...membership(true, true), projectId: otherProjectId },
  { ...membership(true, true), userId: otherUserId },
  { ...membership(true, true), projectId: otherProjectId, userId: otherUserId },
];
export const wrongScopeRows = actorTypes.flatMap((type) =>
  wrongMemberships.map((row, index) => [type, index, row] as const),
);
export const graphRows = states.flatMap((state) =>
  lifecycleActions.map((action) => [state, action] as const),
);
export const reasonRows = actorTypes.flatMap((type) =>
  (["hold", "cancel", "archive", "restore", "reopen"] as const).map(
    (action) => [type, action] as const,
  ),
);
export const restoreRows = actorTypes.flatMap((type) =>
  unarchivedStates.map((state) => [type, state] as const),
);
export const reopenRows = actorTypes.flatMap((type) =>
  (["completed", "canceled"] as const).map((state) => [type, state] as const),
);
export const editingRows = actorTypes.flatMap((type) =>
  (["owner", "edit"] as const).map((relation) => [type, relation] as const),
);
export const formerOwnerRows = actorTypes.flatMap((type) =>
  (["outsider", "read", "edit", "coordinate", "both"] as const).map(
    (relation) => [type, relation] as const,
  ),
);
export const deniedContexts = actorTypes.flatMap((type) => {
  const inactiveOwner = context(type, "owner");
  inactiveOwner.actor.isActive = false;
  return [
    [type, "outsider", context(type, "outsider")],
    [type, "read member", context(type, "read")],
    [type, "edit member", context(type, "edit")],
    [type, "coordinate member", context(type, "coordinate")],
    [
      type,
      "wrong project",
      {
        ...context(type, "both"),
        membership: { ...membership(true, true), projectId: otherProjectId },
      },
    ],
    [type, "inactive owner", inactiveOwner],
  ] as const;
});
export const forgedCommandFields = [
  "actor",
  "context",
  "ownerUserId",
  "membership",
  "projectEdit",
  "assignmentCoordinate",
  "authorized",
  "moduleEnabled",
  "crmVisible",
  "privacyAllowed",
] as const;
