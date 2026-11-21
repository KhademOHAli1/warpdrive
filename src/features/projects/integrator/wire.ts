import type {
  ProjectItem,
  ProjectSettings,
  ProjectSummary,
  ProjectWorkflowState,
} from "../contracts";
import type { ProjectIntakeSummary } from "../intake/contracts";
import type { PlanningGroup } from "../planning/contracts";
import type { ProjectLabel } from "../work-structure/contracts";

const escapable = /[&<>"']/g;
const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function descriptionHtml(description: string) {
  return `<p>${description.replace(escapable, (char) => escapes[char] ?? char).replace(/\n/g, "<br>")}</p>`;
}

export function projectDto(project: ProjectSummary, settings?: ProjectSettings) {
  return {
    id: project.id,
    name: project.title,
    identifier: project.identifier,
    created_at: project.createdAt,
    archived: project.archived,
    timezone: project.timeZone,
    logo_props: project.logo,
    cover: project.cover,
    ...(settings === undefined
      ? {}
      : {
          description: settings.description,
          project_lead: settings.leadUserId,
          default_assignee: settings.defaultAssigneeId,
          intake_view: settings.intakeEnabled,
          revision: settings.revision,
        }),
  };
}

export function workItemDto(projectId: string, item: ProjectItem) {
  return {
    id: item.id,
    project: projectId,
    name: item.title,
    sequence_id: item.sequenceNumber,
    state: item.stateId,
    assignees: item.assigneeId === null ? [] : [item.assigneeId],
    labels: item.labelIds,
    estimate_point: item.estimatePointId,
    priority: item.priority,
    start_date: item.startDate,
    target_date: item.dueDate,
    description_html: descriptionHtml(item.description),
    description_stripped: item.description,
    archived_at: item.archivedAt,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    revision: item.revision,
  };
}

export function stateDto(projectId: string, state: ProjectWorkflowState) {
  return {
    id: state.id,
    project: projectId,
    name: state.name,
    group: state.category,
    sequence: state.position,
    color: state.color,
    default: state.isDefault,
  };
}

export function labelDto(projectId: string, label: ProjectLabel) {
  return {
    id: label.id,
    project: projectId,
    name: label.name,
    description: label.description,
    color: label.color,
    parent: label.parentId,
    sort_order: label.position,
    is_group: label.kind === "group",
  };
}

export function planningDto(projectId: string, group: PlanningGroup) {
  return {
    id: group.id,
    project: projectId,
    name: group.title,
    description: group.description,
    start_date: group.startDate,
    end_date: group.endDate,
    target_date: group.endDate,
    status: group.moduleStatus,
    archived: group.archived,
    revision: group.revision,
  };
}

const intakeStatuses = {
  pending: -2,
  declined: -1,
  snoozed: 0,
  accepted: 1,
  duplicate: 2,
} as const;

export function intakeDto(projectId: string, request: ProjectIntakeSummary, description?: string) {
  return {
    id: request.id,
    status: intakeStatuses[request.status],
    request_status: request.status,
    project: projectId,
    source: "IN_APP",
    snoozed_till: request.snoozedUntil,
    duplicate_to: request.status === "duplicate" ? request.workItemId : null,
    work_item_id: request.workItemId,
    created_by: request.requester.id,
    created_at: request.createdAt,
    revision: request.revision,
    issue: {
      id: request.id,
      project: projectId,
      name: request.title,
      priority: request.priority,
      ...(description === undefined
        ? {}
        : { description_html: descriptionHtml(description), description_stripped: description }),
    },
  };
}
