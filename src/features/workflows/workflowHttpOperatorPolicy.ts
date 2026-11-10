import { z } from "zod";
import { env } from "@/config/env";
import {
  isWorkflowHttpHeaderName,
  isWorkflowHttpHeaderValue,
  workflowHttpMethods,
  workflowHttpsUrl,
} from "./workflowHttpRequestContract";
import type { WorkflowHttpRequestWorkerServices } from "./workflowHttpRequestWorker";

const method = z.enum(workflowHttpMethods);
const header = (operator: boolean) =>
  z.string().refine((value) => isWorkflowHttpHeaderName(value, operator));
const grant = z.strictObject({
  workflowId: z.uuid(),
  url: z
    .string()
    .max(2048)
    .refine((value) => workflowHttpsUrl(value)?.href === value),
  methods: z.array(method).min(1).max(workflowHttpMethods.length),
  authoredHeaders: z.array(header(false)).max(16).optional(),
  operatorHeaders: z.record(header(true), z.string().refine(isWorkflowHttpHeaderValue)).optional(),
});
const grants = z
  .array(grant)
  .max(100)
  .refine((rows) => {
    const keys = rows.map(({ workflowId, url }) => `${workflowId}\n${url}`);
    return new Set(keys).size === keys.length;
  });

export function parseWorkflowHttpOperatorGrants(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 65_536) return [];
  try {
    const payload: unknown = JSON.parse(raw);
    const checked = grants.safeParse(payload);
    return checked.success ? checked.data : [];
  } catch {
    return [];
  }
}

export const workflowHttpOperatorServices: WorkflowHttpRequestWorkerServices = {
  readGrants: ({ workflowId }, signal) => {
    signal.throwIfAborted();
    return parseWorkflowHttpOperatorGrants(env.WORKFLOW_HTTP_GRANTS).filter(
      (entry) => entry.workflowId === workflowId,
    );
  },
};

export function hasWorkflowHttpOperatorGrant(workflowId: string): boolean {
  return parseWorkflowHttpOperatorGrants(env.WORKFLOW_HTTP_GRANTS).some(
    (entry) => entry.workflowId === workflowId,
  );
}
