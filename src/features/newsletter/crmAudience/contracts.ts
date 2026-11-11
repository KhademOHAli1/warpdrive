import { z } from "zod";

export const sealedAudience = z
  .object({
    manifest_uuid: z.uuid(),
    purpose_list_id: z.number().int().positive(),
    sealed_at: z.iso.datetime({ offset: true }),
    size: z.number().int().positive(),
  })
  .nullable();

export type SealedAudience = NonNullable<z.infer<typeof sealedAudience>>;

export type AudiencePreview = {
  approval: string | null;
  rows: {
    id: string;
    name: string;
    status: "eligible" | "missingAddress" | "noCurrentConsent";
  }[];
  eligiblePeople: number;
  recipients: number;
};

export type AudienceViewChoice = { id: string; name: string; available: boolean };
