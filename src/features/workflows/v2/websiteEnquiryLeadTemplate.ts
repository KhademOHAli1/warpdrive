import type { WorkflowV2Definition } from "@/features/blocks/contracts";

export const websiteEnquiryLeadTemplate = {
  schemaVersion: 2,
  trigger: {
    type: "webhook",
    config: {
      authentication: "api_key",
      responseSchema: {
        type: "object",
        properties: {
          inquiryId: { type: "string", minLength: 36, maxLength: 36 },
          contactName: { type: "string", minLength: 2, maxLength: 120 },
          company: { type: "string", minLength: 2, maxLength: 160 },
          workEmail: { type: "string", minLength: 3, maxLength: 254 },
          requestType: {
            type: "string",
            enum: ["quote", "sales", "technical-support", "distribution", "engineering"],
          },
          sourcePath: { type: "string", minLength: 1, maxLength: 300 },
        },
        required: ["inquiryId", "contactName", "company", "workEmail", "requestType", "sourcePath"],
        additionalProperties: false,
      },
    },
  },
  nodes: [
    {
      id: "create-lead",
      type: "CREATE_RECORD",
      version: 1,
      name: "Create possible lead",
      config: {
        objectName: "lead",
        fields: {
          title: { kind: "reference", nodeId: "$trigger", path: ["company"] },
          sourceChannel: "web_form",
          sourceChannelId: { kind: "reference", nodeId: "$trigger", path: ["inquiryId"] },
          sourceOrigin: "website_contact",
        },
      },
    },
  ],
  edges: [],
  entryNodeIds: ["create-lead"],
} satisfies WorkflowV2Definition;
