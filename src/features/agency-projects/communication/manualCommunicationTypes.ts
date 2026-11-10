import type { z } from "zod";
import type {
  manualActionSchema,
  manualCommandSchema,
  manualContextShapeSchema,
  manualDeclarationSchema,
  manualHeadSchema,
  manualReceiptSchema,
} from "./manualCommunicationSchemas";

export type ManualDeclaration = z.infer<typeof manualDeclarationSchema>;
export type ManualAction = z.infer<typeof manualActionSchema>;
export type ManualCommand = z.infer<typeof manualCommandSchema>;
export type ManualHead = z.infer<typeof manualHeadSchema>;
export type ManualReceipt = z.infer<typeof manualReceiptSchema>;
export type ManualContext = z.infer<typeof manualContextShapeSchema>;
type Facts = Readonly<{ personId: string; declaration: ManualDeclaration }>;
type AppendEvent = Readonly<{ receipt: ManualReceipt; before: Facts | null; after: Facts }>;
export type ManualMutation = Readonly<{
  snapshot: ManualHead;
  receipt: ManualReceipt;
  appendEvent: AppendEvent | null;
  replayed: boolean;
}>;
export type ManualFailure =
  | "manual_intent_unavailable"
  | "manual_intent_conflict"
  | "manual_log_exists"
  | "manual_log_missing"
  | "manual_target_conflict"
  | "manual_revision_conflict"
  | "manual_time_conflict"
  | "manual_revision_exhausted";
