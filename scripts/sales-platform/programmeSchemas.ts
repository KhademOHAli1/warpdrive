import { z } from "zod";

const taskId = z.string().regex(/^SP-\d{2}\.[1-8]$/);
const projectId = z.string().regex(/^SP-\d{2}$/);
const boundedText = z.string().max(4000);
const reference = z.string().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const approvedFiles = [
  "INTEGRATION-SAFETY.md",
  "PRD-Warpdrive-Sales-Process-Platform.md",
  "PROJECTS.md",
  "README.md",
  "SOURCES-AND-DECISIONS.md",
  "UX-RESEARCH.md",
  "TASKS.csv",
] as const;

export const journeyCategories = [
  "auth",
  "pipeline-access",
  "records",
  "saved-views",
  "exports",
  "workflows",
  "communications",
  "regional-dates",
  "regional-money",
  "regional-phones",
  "recovery",
  "workspace-isolation",
] as const;

export const manifestSchema = z.object({
  projects: z.literal(16),
  tasks: z.literal(128),
  ux_studies: z.literal(20),
  files: z
    .array(z.object({ path: reference, bytes: z.number().int().nonnegative(), sha256: digest }))
    .length(7),
});

export const ledgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    baselineCommit: z.string().regex(/^[a-f0-9]{40}$/),
    approvedManifestSha256: digest,
    tasks: z
      .array(
        z
          .object({
            id: taskId,
            projectId,
            status: z.enum(["planned", "in-progress", "waiting-external", "complete"]),
            owner: z.literal("sales-platform"),
            dependsOn: z.array(taskId).max(128),
            evidence: z
              .array(
                z
                  .object({
                    path: reference,
                    level: z.enum([
                      "observed-source",
                      "local-unit",
                      "local-runtime",
                      "provider-qualified",
                      "pilot-accepted",
                      "production-operated",
                    ]),
                  })
                  .strict(),
              )
              .max(128),
            remainingGates: z.array(boundedText).max(128),
            notes: boundedText,
          })
          .strict(),
      )
      .max(256),
  })
  .strict();

export const journeysSchema = z
  .object({
    schemaVersion: z.literal(1),
    journeys: z
      .array(
        z
          .object({
            id: reference,
            owner: z.literal("sales-platform"),
            taskIds: z.array(taskId).min(1).max(128),
            surfaces: z.array(reference).min(1).max(128),
            sourceTests: z.array(reference).min(1).max(128),
            fixtures: z.array(reference).max(128),
            pendingGates: z.array(boundedText).min(1).max(128),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export interface ProgrammeIssue {
  code: string;
  path: string;
  message: string;
}
export type Ledger = z.infer<typeof ledgerSchema>;
export type Journeys = z.infer<typeof journeysSchema>;
export interface ApprovedTask {
  id: string;
  projectId: string;
  dependsOn: string[];
}
