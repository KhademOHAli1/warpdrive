import { z } from "zod";
import { SAVED_VIEW_PRESENTATION_VERSION } from "./viewDefinitionConstants";
import {
  captureSavedViewPresentation,
  isSavedViewPresentationTarget,
  type SavedViewPresentationTarget,
} from "./viewPresentation";

const baselinePresentation = z.strictObject({
  version: z.literal(SAVED_VIEW_PRESENTATION_VERSION),
});

function fullPresentationSchema(targetEntity: SavedViewPresentationTarget) {
  return z
    .strictObject({
      version: z.literal(SAVED_VIEW_PRESENTATION_VERSION),
      columns: z.array(z.string()),
      sort: z.strictObject({ field: z.string(), dir: z.enum(["asc", "desc"]) }),
    })
    .transform((value, ctx) => {
      const captured = captureSavedViewPresentation(targetEntity, value.columns, value.sort);
      if (captured.ok) return captured.value;
      ctx.addIssue({
        code: "custom",
        message: captured.error,
        path: [captured.error === "unsupported-column" ? "columns" : "sort"],
      });
      return z.NEVER;
    });
}

export function savedViewPresentationSchemaFor(targetEntity: string) {
  return isSavedViewPresentationTarget(targetEntity)
    ? z.union([baselinePresentation, fullPresentationSchema(targetEntity)])
    : baselinePresentation;
}
