import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import {
  SAVED_FILTER_TARGET_ENTITIES,
  type SavedFilterTargetEntity,
  savedFilterDefinitionSchema,
} from "./schemas";
import { SAVED_VIEW_DEFINITION_VERSION } from "./viewDefinitionConstants";
import type { ReservedSavedViewPresentation, SavedViewPresentation } from "./viewPresentation";
import { savedViewPresentationSchemaFor } from "./viewPresentationSchema";

export { SAVED_VIEW_DEFINITION_VERSION };
export type SavedViewFilterDefinition = z.output<ReturnType<typeof savedFilterDefinitionSchema>>;
const envelopeSchema = z.strictObject({
  version: z.literal(SAVED_VIEW_DEFINITION_VERSION),
  targetEntity: z.enum(SAVED_FILTER_TARGET_ENTITIES),
  definition: z.unknown().refine((value) => value !== undefined),
  presentation: z.unknown().optional(),
});
export type SavedViewEnvelopeV1 = {
  version: typeof SAVED_VIEW_DEFINITION_VERSION;
  targetEntity: SavedFilterTargetEntity;
  definition: SavedViewFilterDefinition;
  presentation?: ReservedSavedViewPresentation | SavedViewPresentation;
};
export type DecodedSavedViewDefinition = {
  source: "legacy" | "v1";
  envelope: SavedViewEnvelopeV1;
};
type ProblemCode =
  | "unsupported-version"
  | "unsupported-field"
  | "unsupported-operator"
  | "unsupported-target"
  | "unsupported-keys"
  | "unsupported-presentation"
  | "invalid-envelope"
  | "invalid-definition"
  | "entity-mismatch";
export type SavedViewDefinitionProblem = {
  kind: "unsupported" | "invalid";
  code: ProblemCode;
  recovery: "retain-original";
  raw: unknown;
  paths: Array<Array<string | number>>;
};
type DecodeResult<T> = Result<T, SavedViewDefinitionProblem>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function problem(
  raw: unknown,
  kind: SavedViewDefinitionProblem["kind"],
  code: ProblemCode,
  paths: Array<Array<string | number>> = [],
): SavedViewDefinitionProblem {
  return { kind, code, recovery: "retain-original", raw, paths };
}

function validationProblem(
  raw: unknown,
  issues: z.ZodError["issues"],
  fallback: "invalid-definition" | "invalid-envelope",
): SavedViewDefinitionProblem {
  const paths = issues.map((issue) =>
    issue.path.map((part) => (typeof part === "number" ? part : String(part))),
  );
  if (issues.some((issue) => issue.code === "unrecognized_keys"))
    return problem(raw, "unsupported", "unsupported-keys", paths);
  const unknownValue = issues.find((issue) => issue.code === "invalid_value");
  const key = unknownValue?.path.at(-1);
  if (key === "field") return problem(raw, "unsupported", "unsupported-field", paths);
  if (key === "op") return problem(raw, "unsupported", "unsupported-operator", paths);
  if (key === "targetEntity") return problem(raw, "unsupported", "unsupported-target", paths);
  return problem(raw, "invalid", fallback, paths);
}

// Existing Zod objects strip nested unknown keys. Refuse that loss instead of applying a weaker
// filter. The original payload remains available to an authorized recovery flow.
function strippedObjectPath(
  raw: Record<string, unknown>,
  parsed: Record<string, unknown>,
  path: Array<string | number>,
): Array<string | number> | undefined {
  for (const key of Object.keys(raw)) {
    const next = [...path, key];
    if (!Object.hasOwn(parsed, key)) return next;
    const found = strippedPath(raw[key], parsed[key], next);
    if (found !== undefined) return found;
  }
  return undefined;
}

function strippedPath(
  raw: unknown,
  parsed: unknown,
  path: Array<string | number> = [],
): Array<string | number> | undefined {
  if (isRecord(raw) && isRecord(parsed)) return strippedObjectPath(raw, parsed, path);
  if (!Array.isArray(raw) || !Array.isArray(parsed)) return undefined;
  for (const [index, value] of raw.entries()) {
    const found = strippedPath(value, parsed[index], [...path, index]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function decodeFilter(
  targetEntity: SavedFilterTargetEntity,
  raw: unknown,
  original: unknown,
): DecodeResult<SavedViewFilterDefinition> {
  const parsed = savedFilterDefinitionSchema(targetEntity).strict().safeParse(raw);
  if (!parsed.success)
    return err(validationProblem(original, parsed.error.issues, "invalid-definition"));
  const discarded = strippedPath(raw, parsed.data);
  if (discarded !== undefined)
    return err(problem(original, "unsupported", "unsupported-keys", [discarded]));
  return ok(parsed.data);
}

export function decodeSavedViewDefinition(
  targetEntity: SavedFilterTargetEntity,
  raw: unknown,
): DecodeResult<DecodedSavedViewDefinition> {
  const versioned = isRecord(raw) && Object.hasOwn(raw, "version");
  if (!versioned) {
    const definition = decodeFilter(targetEntity, raw, raw);
    if (!definition.ok) return definition;
    return ok({
      source: "legacy",
      envelope: {
        version: SAVED_VIEW_DEFINITION_VERSION,
        targetEntity,
        definition: definition.value,
      },
    });
  }
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1)
    return err(problem(raw, "invalid", "invalid-envelope", [["version"]]));
  if (raw.version !== SAVED_VIEW_DEFINITION_VERSION)
    return err(problem(raw, "unsupported", "unsupported-version", [["version"]]));
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success)
    return err(validationProblem(raw, envelope.error.issues, "invalid-envelope"));
  if (envelope.data.targetEntity !== targetEntity)
    return err(problem(raw, "invalid", "entity-mismatch", [["targetEntity"]]));
  const definition = decodeFilter(targetEntity, envelope.data.definition, raw);
  if (!definition.ok) return definition;
  const presentation =
    envelope.data.presentation === undefined
      ? undefined
      : savedViewPresentationSchemaFor(targetEntity).safeParse(envelope.data.presentation);
  if (presentation !== undefined && !presentation.success)
    return err(problem(raw, "unsupported", "unsupported-presentation", [["presentation"]]));
  return ok({
    source: "v1",
    envelope: {
      version: SAVED_VIEW_DEFINITION_VERSION,
      targetEntity,
      definition: definition.value,
      ...(presentation === undefined ? {} : { presentation: presentation.data }),
    },
  });
}

// Encoding is explicit and pure: it does not persist, grant authority, or change query semantics.
export function encodeSavedViewDefinition(
  targetEntity: SavedFilterTargetEntity,
  raw: unknown,
): DecodeResult<SavedViewEnvelopeV1> {
  const decoded = decodeSavedViewDefinition(targetEntity, raw);
  return decoded.ok ? ok(decoded.value.envelope) : decoded;
}
