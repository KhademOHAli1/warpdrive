import type { MappableEntity } from "./importFields";

export interface SynonymTarget {
  entity: MappableEntity;
  field: string;
}

type SynonymTable = Record<string, SynonymTarget>;

function at(entity: MappableEntity, field: string): SynonymTarget {
  return { entity, field };
}

const PERSON_NAME = at("person", "name");
const ORG_NAME = at("organization", "name");

const DEAL: SynonymTable = {
  id: at("deal", "pipedriveId"),
  title: at("deal", "title"),
  owner: at("deal", "owner"),
  value: at("deal", "value"),
  status: at("deal", "status"),
  "won time": at("deal", "wonTime"),
  "lost time": at("deal", "lostTime"),
  "lost reason": at("deal", "lostReason"),
  label: at("deal", "labels"),
  labels: at("deal", "labels"),
  "add time": at("deal", "createdAt"),
  created: at("deal", "createdAt"),
  "expected close date": at("deal", "expectedCloseDate"),
  pipeline: at("deal", "pipeline"),
  stage: at("deal", "stage"),
  "contact person": PERSON_NAME,
  organization: ORG_NAME,
};

const LEAD: SynonymTable = {
  id: at("lead", "pipedriveId"),
  title: at("lead", "title"),
  "lead title": at("lead", "title"),
  owner: at("lead", "owner"),
  "lead owner": at("lead", "owner"),
  value: at("lead", "value"),
  label: at("lead", "labels"),
  labels: at("lead", "labels"),
  "add time": at("lead", "createdAt"),
  created: at("lead", "createdAt"),
  "expected close date": at("lead", "expectedCloseDate"),
  archived: at("lead", "archived"),
  "contact person": PERSON_NAME,
  organization: ORG_NAME,
};

const PERSON: SynonymTable = {
  id: at("person", "pipedriveId"),
  name: PERSON_NAME,
  owner: at("person", "owner"),
  organization: ORG_NAME,
};

const ORGANIZATION: SynonymTable = {
  id: at("organization", "pipedriveId"),
  name: ORG_NAME,
  owner: at("organization", "owner"),
};

const LINKS: SynonymTable = {
  "deal id": at("activity", "dealPipedriveId"),
  "person id": at("activity", "personPipedriveId"),
  "organization id": at("activity", "orgPipedriveId"),
  "deal title": at("activity", "dealTitle"),
  deal: at("activity", "dealTitle"),
  "lead id": at("activity", "leadPipedriveId"),
  "lead title": at("activity", "leadTitle"),
  lead: at("activity", "leadTitle"),
  "contact person": at("activity", "personName"),
  person: at("activity", "personName"),
  organization: at("activity", "orgName"),
};

const ACTIVITY: SynonymTable = {
  id: at("activity", "pipedriveId"),
  subject: at("activity", "subject"),
  type: at("activity", "typeKey"),
  "due date": at("activity", "dueAt"),
  "due time": at("activity", "dueTime"),
  duration: at("activity", "durationMinutes"),
  done: at("activity", "done"),
  "marked as done time": at("activity", "doneAt"),
  "assigned to user": at("activity", "assignee"),
  ...LINKS,
};

const NOTE: SynonymTable = {
  id: at("note", "pipedriveId"),
  content: at("note", "body"),
  "add time": at("note", "createdAt"),
  created: at("note", "createdAt"),
  ...Object.fromEntries(
    Object.entries(LINKS).map(([header, target]) => [header, at("note", target.field)]),
  ),
};

export const PIPEDRIVE_SYNONYMS: Partial<Record<MappableEntity, SynonymTable>> = {
  deal: DEAL,
  lead: LEAD,
  person: PERSON,
  organization: ORGANIZATION,
  activity: ACTIVITY,
  note: NOTE,
};

export const PIPEDRIVE_HEADER_PREFIX_ENTITIES: Record<string, MappableEntity | null> = {
  deal: "deal",
  person: "person",
  organization: "organization",
  activity: "activity",
  note: "note",
  lead: "lead",
};
