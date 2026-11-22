import { z } from "zod";
import { type LabelFormat, labelFormats } from "./formats";

export const labelTargetKinds = [
  "asset",
  "kit",
  "stock_position",
  "location",
  "part",
  "release",
  "supplier_offer",
] as const;

const id = z.uuid().toLowerCase();
export const labelTargetRef = z.strictObject({ kind: z.enum(labelTargetKinds), id });

export type LabelTargetRef = z.infer<typeof labelTargetRef>;
export type LabelTargetKind = LabelTargetRef["kind"];

export type LabelTarget = LabelTargetRef & {
  title: string;
  subtitle: string | null;
  href: string | null;
  canManage: boolean;
};

export type LabelRecord = {
  id: string;
  format: LabelFormat;
  value: string;
  source: "internal" | "external";
  target: LabelTarget;
  createdAt: string;
  retiredAt: string | null;
};

export type LabelsWorkspace = {
  targets: LabelTarget[];
  labels: LabelRecord[];
};

const input = z.string().min(1).max(4_096);
export const labelCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("issue"), requestId: id, target: labelTargetRef }),
  z.strictObject({
    type: z.literal("registerExternal"),
    requestId: id,
    target: labelTargetRef,
    format: z.enum(labelFormats),
    value: input,
  }),
  z.strictObject({ type: z.literal("retire"), requestId: id, labelId: id }),
]);
export type LabelCommand = z.infer<typeof labelCommand>;

export const scanInput = z.strictObject({
  value: input,
  format: z.enum(labelFormats).optional(),
});
export type ScanInput = z.infer<typeof scanInput>;

export type LabelError = "invalid" | "unavailable" | "conflict" | "state";
export type LabelResult =
  | { ok: true; value: LabelsWorkspace; focusId: string }
  | { ok: false; error: LabelError };

export type LabelWorkspaceResult =
  | { ok: true; value: LabelsWorkspace }
  | { ok: false; error: "unavailable" };

export type ScanResult =
  | { ok: true; label: LabelRecord }
  | { ok: false; error: "invalid" | "unavailable" };
