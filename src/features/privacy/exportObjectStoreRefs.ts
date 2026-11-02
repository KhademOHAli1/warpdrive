import { z } from "zod";

const opaqueUuid = z.uuid().transform((value) => value.toLowerCase());
const ids = { artifactId: opaqueUuid, attemptId: opaqueUuid };
export const exportObjectVersionSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => value !== "null");
export const attemptRefSchema = z.object(ids).strict();
export const objectRefSchema = z.object({ ...ids, versionId: exportObjectVersionSchema }).strict();
const storedObjectSchema = objectRefSchema.extend({
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
// A stored receipt is a known strict superset, while arbitrary caller metadata remains rejected.
export const objectRefInputSchema = z
  .union([objectRefSchema, storedObjectSchema])
  .transform((ref) => ({
    artifactId: ref.artifactId,
    attemptId: ref.attemptId,
    versionId: ref.versionId,
  }));
export const uploadRefSchema = z.object({ ...ids, uploadId: z.string().min(1).max(4096) }).strict();
export const objectStoreConfigSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
    accessKey: z.string().min(1).max(4096),
    secretKey: z.string().min(1).max(4096),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u),
    requestTimeoutMs: z.number().int().min(1).max(30_000),
  })
  .strict();
export function exportObjectKey(ref: { artifactId: string; attemptId: string }): string {
  return `privacy-exports/v1/${ref.artifactId}/${ref.attemptId}.tar.gz`;
}
