import type { StandardImportField } from "./importFields";

const PIPEDRIVE_ONLY = ["pipedrive"] as const;

function pipedriveField(field: string, label: string): StandardImportField {
  return { field, label, required: false, sources: PIPEDRIVE_ONLY };
}

const PIPEDRIVE_ID = pipedriveField("pipedriveId", "Pipedrive ID");
const OWNER = pipedriveField("owner", "Owner");

const LINK_FIELDS: readonly StandardImportField[] = [
  pipedriveField("dealPipedriveId", "Deal ID"),
  pipedriveField("personPipedriveId", "Person ID"),
  pipedriveField("orgPipedriveId", "Organization ID"),
  pipedriveField("dealTitle", "Deal title"),
  pipedriveField("personName", "Person name"),
  pipedriveField("orgName", "Organization name"),
];

export const PIPEDRIVE_PERSON_FIELDS: readonly StandardImportField[] = [PIPEDRIVE_ID, OWNER];
export const PIPEDRIVE_ORGANIZATION_FIELDS: readonly StandardImportField[] = [PIPEDRIVE_ID, OWNER];

export const PIPEDRIVE_DEAL_FIELDS: readonly StandardImportField[] = [
  PIPEDRIVE_ID,
  OWNER,
  pipedriveField("status", "Status"),
  pipedriveField("wonTime", "Won time"),
  pipedriveField("lostTime", "Lost time"),
  pipedriveField("lostReason", "Lost reason"),
  pipedriveField("labels", "Labels"),
  pipedriveField("createdAt", "Created"),
];

export const PIPEDRIVE_ACTIVITY_FIELDS: readonly StandardImportField[] = [
  PIPEDRIVE_ID,
  pipedriveField("assignee", "Assigned to"),
  pipedriveField("done", "Done"),
  pipedriveField("doneAt", "Done time"),
  pipedriveField("dueTime", "Due time"),
  ...LINK_FIELDS,
];

export const PIPEDRIVE_NOTE_FIELDS: readonly StandardImportField[] = [
  PIPEDRIVE_ID,
  pipedriveField("createdAt", "Created"),
  ...LINK_FIELDS,
];
