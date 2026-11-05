import { type NativeFieldMetadata, type NativeObjectName, nativeOperators } from "./nativeFields";

type Field = [
  key: string,
  label: string,
  type: NativeFieldMetadata["valueType"],
  create?: boolean,
  update?: boolean,
  required?: boolean,
  format?: string,
  reference?: NativeFieldMetadata["referenceObject"],
];
const common: Field[] = [
  ["id", "Record ID", "string", false, false, false, "uuid"],
  ["ownerId", "Owner", "string", false, false, false, "uuid", "user"],
  ["createdAt", "Created at", "string", false, false, false, "datetime"],
  ["updatedAt", "Updated at", "string", false, false, false, "datetime"],
];
const opportunity: Field[] = [
  ["title", "Title", "string", true, true, true],
  ["value", "Value", "number", true, true],
  ["currency", "Currency", "string", true, true],
  ["expectedCloseDate", "Expected close date", "string", true, true, false, "date"],
  ["labels", "Labels", "array", true, true],
  ["personId", "Person", "string", true, false, false, "uuid", "person"],
  ["orgId", "Organization", "string", true, false, false, "uuid", "organization"],
  ["sourceChannel", "Source channel", "string", true, false],
  ["sourceChannelId", "Source ID", "string", true, false],
];
const fields: Record<NativeObjectName, Field[]> = {
  deal: [
    ...opportunity.map(
      (field): Field => [
        field[0],
        field[1],
        field[2],
        field[3],
        field[0] !== "ownerId",
        field[5],
        field[6],
        field[7],
      ],
    ),
    ["pipelineId", "Pipeline", "string", true, false, true, "uuid", "pipeline"],
    ["stageId", "Stage", "string", true, false, true, "uuid", "stage"],
    ["status", "Status", "string", false, true],
    ["lostReason", "Lost reason", "string", false, true],
  ],
  lead: [...opportunity, ["sourceOrigin", "Source origin", "string", true, false]],
  person: [
    ["name", "Name", "string", true, true, true],
    ["firstName", "First name", "string", true, true],
    ["lastName", "Last name", "string", true, true],
    ["primaryEmail", "Primary email", "string", false, false, false, "email"],
    ["emails", "Email addresses", "array", true, true],
    ["phones", "Phone numbers", "array", true, true],
    ["orgId", "Organization", "string", true, true, false, "uuid", "organization"],
    ["labels", "Labels", "array", false, true],
  ],
  organization: [
    ["name", "Name", "string", true, true, true],
    ["address", "Address", "object", true, true],
    ["domain", "Domain", "string", false, true],
    ["industry", "Industry", "string", false, true],
    ["linkedinUrl", "LinkedIn URL", "string", false, true],
    ["employeeCount", "Employee count", "number", false, true],
    ["annualRevenue", "Annual revenue", "number", false, true],
    ["labels", "Labels", "array", false, true],
  ],
  activity: [
    ["subject", "Subject", "string", true, true, true],
    ["typeId", "Activity type", "string", true, true, true, "uuid", "activityType"],
    ["dueAt", "Start time", "string", true, true, false, "datetime"],
    ["endAt", "End time", "string", true, true, false, "datetime"],
    ["allDay", "All day", "boolean", true, true],
    ["dueDate", "Start date", "string", true, true, false, "date"],
    ["endDate", "End date", "string", true, true, false, "date"],
    ["durationMinutes", "Duration in minutes", "number", true, true],
    ["priority", "Priority", "string", true, true],
    ["done", "Completed", "boolean", true, true],
    ["assigneeId", "Assignee", "string", true, true, false, "uuid", "user"],
    ["dealId", "Deal", "string", true, true, false, "uuid", "deal"],
    ["leadId", "Lead", "string", true, true, false, "uuid", "lead"],
    ["personId", "Person", "string", true, true, false, "uuid", "person"],
    ["orgId", "Organization", "string", true, true, false, "uuid", "organization"],
    ["location", "Location", "string", true, true],
    ["note", "Note", "string", true, true],
    ["videoCallUrl", "Video call URL", "string", true, true],
  ],
};

export function nativeBuiltinFields(objectName: NativeObjectName): NativeFieldMetadata[] {
  return [...common, ...fields[objectName]].map(
    ([
      key,
      label,
      valueType,
      createable = false,
      updateable = false,
      required = false,
      format,
      referenceObject,
    ]) => ({
      key,
      label,
      valueType,
      createable,
      updateable,
      required,
      format,
      referenceObject,
      readable: true,
      upsertIdentity: key === "id" || key === "primaryEmail",
      filterOperators: nativeOperators(valueType, format, referenceObject),
    }),
  );
}
