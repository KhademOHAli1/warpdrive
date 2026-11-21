import { z } from "zod";
import { isTimeZone } from "@/features/i18n/preferences";
import { maxProjectCoverUpload, projectBrandIcons, projectCoverPresets } from "./contracts";

export const projectTimeZoneInput = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/u)
  .refine(isTimeZone);

export const projectLogoInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("emoji"),
    value: z
      .string()
      .max(32)
      .regex(
        /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|[\u{E0020}-\u{E007F}])*$/u,
      )
      .refine((value) => {
        const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value);
        return Array.from(segments).length === 1;
      }),
  }),
  z.strictObject({
    kind: z.literal("icon"),
    value: z.enum(projectBrandIcons),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/u)
      .toLowerCase(),
  }),
]);

export const projectCoverInput = z.strictObject({
  kind: z.literal("preset"),
  value: z.enum(projectCoverPresets),
});

export const projectCoverImageInput = z
  .string()
  .min(8)
  .max(Math.ceil(maxProjectCoverUpload / 3) * 4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u);
