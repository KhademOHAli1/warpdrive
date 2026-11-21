import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import {
  projectDocumentBodyMaxLength,
  projectDocumentLifecycleActions,
  projectDocumentTitleMaxLength,
  projectDocumentVisibilities,
} from "./contracts";
import {
  projectDocumentCollaborationMaxBytes,
  projectDocumentStateVectorMaxBytes,
} from "./live/contracts";
import { projectDocumentPresenceInput } from "./live/presenceInput";

const projectId = canonicalUuidSchema;
const title = projectCreateInputSchema.shape.title.pipe(
  z.string().max(projectDocumentTitleMaxLength),
);
const documentKey = { projectId, documentId: canonicalUuidSchema };

export const listProjectDocumentsInput = z.strictObject({ projectId });
export const readProjectDocumentInput = z.strictObject(documentKey);
export const readProjectDocumentVersionInput = z.strictObject({
  ...documentKey,
  versionRevision: revisionSchema,
});

export const createProjectDocumentInput = z.strictObject({
  projectId,
  id: canonicalUuidSchema,
  title,
  visibility: z.enum(projectDocumentVisibilities),
});

export const saveProjectDocumentInput = z.strictObject({
  ...documentKey,
  revision: revisionSchema,
  title,
  bodyHtml: z.string().max(projectDocumentBodyMaxLength).optional(),
});

const encodedBytes = (maxBytes: number) => z.string().max(4 * Math.ceil(maxBytes / 3));

export const collaborateProjectDocumentInput = z.strictObject({
  ...documentKey,
  epoch: revisionSchema.nullable(),
  revision: revisionSchema.nullable(),
  stateVector: encodedBytes(projectDocumentStateVectorMaxBytes).nullable(),
  update: encodedBytes(projectDocumentCollaborationMaxBytes).nullable(),
  presence: projectDocumentPresenceInput.nullable().optional(),
  csrfToken: z.string().max(128).nullable(),
});

export const setProjectDocumentLifecycleInput = z.strictObject({
  ...documentKey,
  revision: revisionSchema,
  action: z.enum(projectDocumentLifecycleActions),
});

export const restoreProjectDocumentVersionInput = readProjectDocumentVersionInput.extend({
  revision: revisionSchema,
});
