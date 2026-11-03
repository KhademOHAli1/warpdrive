import { z } from "zod";
import { midpoint } from "./boardPosition";

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const position = z
  .string()
  .max(100)
  .regex(/^-?\d+(?:\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)))
  .nullable();
export const nativeStageReadInput = z.strictObject({
  protocolVersion: z.literal(1),
  expectedActorId: uuid,
  dealId: uuid,
});
// This is a separate native contract. Legacy/MCP/import timestamp consumers stay unchanged.
export const nativeStageMoveInput = nativeStageReadInput
  .extend({
    pipelineId: uuid,
    toStageId: uuid,
    expectedWriteVersion: uuid,
    beforePosition: position,
    afterPosition: position,
  })
  .refine((input) => {
    const value = Number(midpoint(input.beforePosition, input.afterPosition));
    return (
      Number.isFinite(value) &&
      (input.beforePosition === null || value > Number(input.beforePosition)) &&
      (input.afterPosition === null || value < Number(input.afterPosition))
    );
  });
export type NativeStageMoveInput = z.infer<typeof nativeStageMoveInput>;
export type NativeStageReadInput = z.infer<typeof nativeStageReadInput>;
export interface NativeStageSnapshot {
  id: string;
  pipelineId: string;
  stageId: string;
  status: "open" | "won" | "lost";
  boardPosition: string;
  updatedAt: string;
  writeVersion: string;
}
export interface NativeStageFailure {
  ok: false;
  reason: "invalid" | "denied" | "conflict" | "unavailable";
  errorId?: string;
}
export type NativeStageMoveResult = { ok: true; deal: NativeStageSnapshot } | NativeStageFailure;
export type NativeStageReadResult =
  | { ok: true; deal: NativeStageSnapshot | null }
  | NativeStageFailure;
