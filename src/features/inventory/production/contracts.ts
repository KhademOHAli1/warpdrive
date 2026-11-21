import { z } from "zod";
import type { Result } from "@/types/result";
import { type BomPart, type BomRelease, bomLineChoice } from "../bom/contracts";

const id = z.uuid().toLowerCase();
const quantity = z.number().int().min(1).max(1_000_000);
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes("\0"));
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(80)
  .refine((value) => !value.includes("\0"));
const requestId = id;
const versioned = { requestId, buildId: id, version: z.number().int().min(1).max(2147483646) };

export const productionStatuses = ["planned", "issued", "on_hold", "closed", "cancelled"] as const;
export const productionPriorities = ["low", "normal", "high", "urgent"] as const;
export const productionOutputStatuses = [
  "wip",
  "completed",
  "scrapped",
  "cancelled",
  "reversed",
] as const;
export type ProductionStatus = (typeof productionStatuses)[number];
export type ProductionPriority = (typeof productionPriorities)[number];
export type ProductionOutputStatus = (typeof productionOutputStatuses)[number];

export const productionCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("createBuild"),
    requestId,
    releaseId: id,
    siteId: id,
    locationId: id,
    quantity,
    priority: z.enum(productionPriorities),
    dueDate: z.iso.date().nullable(),
    useTemplate: z.boolean(),
    choices: z.array(bomLineChoice).max(120),
  }),
  z.strictObject({
    type: z.literal("schedule"),
    ...versioned,
    priority: z.enum(productionPriorities),
    dueDate: z.iso.date().nullable(),
  }),
  z.strictObject({ type: z.literal("issue"), ...versioned }),
  z.strictObject({ type: z.literal("hold"), ...versioned, reason }),
  z.strictObject({ type: z.literal("resume"), ...versioned, reason }),
  z.strictObject({
    type: z.literal("allocate"),
    ...versioned,
    materialId: id,
    positionId: id,
    quantity,
  }),
  z.strictObject({
    type: z.literal("deallocate"),
    ...versioned,
    materialId: id,
    positionId: id,
    quantity,
  }),
  z.strictObject({ type: z.literal("autoAllocate"), ...versioned }),
  z.strictObject({ type: z.literal("startBatch"), ...versioned, quantity }),
  z
    .strictObject({
      type: z.literal("finalizeBatch"),
      ...versioned,
      outputId: id,
      disposition: z.enum(["completed", "scrapped"]),
      lot: code.nullable(),
      serials: z.array(code).max(500),
      reason,
    })
    .refine(({ serials }) => new Set(serials).size === serials.length),
  z.strictObject({ type: z.literal("cancelBatch"), ...versioned, outputId: id, reason }),
  z.strictObject({ type: z.literal("reverseOutput"), ...versioned, outputId: id, reason }),
  z.strictObject({ type: z.literal("cancelBuild"), ...versioned, reason }),
  z.strictObject({
    type: z.literal("linkSubcontract"),
    ...versioned,
    orderId: id,
    lineId: id,
    supplierBinId: id,
    companyMaterialIds: z
      .array(id)
      .max(600)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.strictObject({
    type: z.literal("dispatchSubcontract"),
    ...versioned,
    reason,
    allocations: z
      .array(z.strictObject({ materialId: id, positionId: id, quantity }))
      .min(1)
      .max(600)
      .refine(
        (lines) =>
          new Set(lines.map(({ materialId, positionId }) => `${materialId}:${positionId}`)).size ===
          lines.length,
      ),
  }),
  z.strictObject({
    type: z.literal("returnSubcontractMaterial"),
    ...versioned,
    dispatchId: id,
    quantity,
    reason,
  }),
  z.strictObject({
    type: z.literal("releaseSubcontractOutput"),
    ...versioned,
    outputId: id,
    reason,
  }),
]);

export const productionQuery = z.strictObject({
  buildId: id.optional(),
  siteId: id.optional(),
  releaseId: id.optional(),
});
export type ProductionQuery = z.infer<typeof productionQuery>;
export type ProductionCommand = z.infer<typeof productionCommand>;
export type SubcontractCommand = Extract<
  ProductionCommand,
  {
    type:
      | "linkSubcontract"
      | "dispatchSubcontract"
      | "returnSubcontractMaterial"
      | "releaseSubcontractOutput";
  }
>;
export type ExistingProductionCommand = Exclude<
  ProductionCommand,
  { type: "createBuild" } | SubcontractCommand
>;
type WithNoReceipt<C> = C extends { requestId: string } ? Omit<C, "requestId"> : never;
export type ProductionIntent = WithNoReceipt<ProductionCommand>;

export type ProductionPosition = {
  id: string;
  location: string;
  lot: string | null;
  serial: string | null;
  free: number;
  buildOutputId: string | null;
  sourceBuildId?: string;
};

export type ProductionMaterial = {
  id: string;
  part: BomPart;
  releaseId: string | null;
  perUnit: number;
  demand: number;
  allocated: number;
  consumed: number;
  consumable: boolean;
  positions: ProductionPosition[];
  allocations: { position: ProductionPosition; quantity: number }[];
};

export type ProductionOutput = {
  id: string;
  quantity: number;
  status: ProductionOutputStatus;
  lot: string | null;
  serials: string[];
  reason: string | null;
  createdAt: string;
  quality?: { serial: string; status: "pending" | "failed" | "passed" }[];
  inputs: { part: BomPart; position: ProductionPosition; quantity: number; eventId: string }[];
};

export type ProductionBuild = {
  id: string;
  version: number;
  release: BomRelease;
  parentId: string | null;
  siteId: string;
  site: string;
  location: string;
  quantity: number;
  completed: number;
  scrapped: number;
  status: ProductionStatus;
  priority: ProductionPriority;
  dueDate: string | null;
  createdAt: string;
  trackable: boolean;
  canManage: boolean;
};

export type ProductionDetail = ProductionBuild & {
  children: ProductionBuild[];
  materials: ProductionMaterial[];
  outputs: ProductionOutput[];
  project: {
    id: string;
    title: string;
    tasks: { id: string; title: string; completed: boolean }[];
  } | null;
  history: { id: string; type: ProductionCommand["type"]; reason: string | null; at: string }[];
  subcontractOptions: SubcontractOptions | null;
  subcontract: SubcontractView | null;
};

export type SubcontractOptions = {
  lines: { id: string; orderId: string; reference: string; supplier: string; quantity: number }[];
  bins: { id: string; code: string; name: string }[];
};

export type SubcontractView = {
  orderId: string | null;
  reference: string | null;
  orderStatus: "draft" | "open" | "partial" | "received" | "cancelled";
  supplierBin: string;
  companyMaterialIds: string[];
  custody: {
    id: string;
    materialId: string;
    quantity: number;
    consumed: number;
    returned: number;
    lot: string | null;
    serial: string | null;
  }[];
  outputs: { outputId: string; receiptLineId: string }[];
  canDispatch: boolean;
  canReturn: boolean;
  canRelease: boolean;
};

export type ProductionWorkspace = {
  builds: ProductionBuild[];
  detail: ProductionDetail | null;
  releases: (BomRelease & { templateAvailable: boolean })[];
  sites: {
    id: string;
    code: string;
    name: string;
    canManage: boolean;
    locations: { id: string; code: string; name: string }[];
  }[];
};

export type ProductionError =
  | "unavailable"
  | "invalid"
  | "stale"
  | "stock"
  | "state"
  | "unitChanged"
  | "limit"
  | "project"
  | "serial"
  | "reversal"
  | "subcontract";
export type ProductionResult = Result<ProductionWorkspace, ProductionError>;
export type ProductionEffect = Result<{ buildId: string }, ProductionError>;
