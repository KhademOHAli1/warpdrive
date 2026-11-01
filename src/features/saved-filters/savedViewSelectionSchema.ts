import { z } from "zod";

export const SAVED_VIEW_SELECTION_KEYS = {
  person: "peopleSavedViewSelection",
  organization: "orgsSavedViewSelection",
  lead: "leadsSavedViewSelection",
} as const;

export const savedViewSelectionSchema = z.strictObject({
  version: z.literal(1),
  savedViewId: z.string().uuid().nullable(),
});
export const savedViewSelectionInputSchema = z.strictObject({
  targetEntity: z.enum(["person", "organization", "lead"]),
  savedViewId: z.string().uuid().nullable(),
});
export const savedViewSelectionActorHintSchema = z.string().uuid().optional();
export const BLOCKED_SAVED_VIEW_SELECTION = {
  status: "blocked",
  reason: "invalid-selection",
} as const;
export type SavedViewSelection = z.infer<typeof savedViewSelectionSchema>;
export type SavedViewSelectionRead = SavedViewSelection | typeof BLOCKED_SAVED_VIEW_SELECTION;

// A corrupt selection cannot mean All records. Keep an explicit read-side sentinel while other
// malformed UI preferences remain independently recoverable.
export const storedSavedViewSelectionSchema = z
  .unknown()
  .optional()
  .transform((raw): SavedViewSelectionRead | undefined => {
    if (raw === undefined) return undefined;
    const parsed = savedViewSelectionSchema.safeParse(raw);
    return parsed.success ? parsed.data : BLOCKED_SAVED_VIEW_SELECTION;
  });
