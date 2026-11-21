import { z } from "zod";
import type { Result } from "@/types/result";
import type { CatalogUnit } from "../catalog/contracts";

const id = z.uuid().toLowerCase();

export const bomLineChoice = z.strictObject({
  releaseId: id,
  itemId: id,
  substituteItemId: id.optional(),
  include: z.boolean().optional(),
});

export const bomPlanningQuery = z.strictObject({
  releaseId: id.optional(),
  partId: id.optional(),
  siteId: id.optional(),
  compareReleaseId: id.optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  choices: z.array(bomLineChoice).max(120).optional(),
});

export type BomPlanningQuery = z.infer<typeof bomPlanningQuery>;

export type BomPart = {
  id: string;
  code: string;
  sku: string;
  name: string;
  revision: string;
  unit: CatalogUnit;
};

export type BomRelease = {
  id: string;
  part: BomPart;
  revision: string;
  checksum: string | null;
};

export type BomSite = { id: string; code: string; name: string };

export type BomEdge = {
  releaseId: string;
  primary: BomPart & { quantity: number };
  alternatives: (BomPart & { quantity: number })[];
  chosenItemId: string;
  childReleaseId: string | null;
  enteredQuantity: string;
  enteredUnit: CatalogUnit;
  optional: boolean;
  included: boolean;
  inherited: boolean;
  consumable: boolean;
  piecesPerParent: number | null;
  requiredPieces: number | null;
};

export type BomRequirement = {
  part: BomPart;
  releaseId: string | null;
  required: number;
  available: number;
  shortage: number;
  genericAssemblyAvailable: number;
  consumable: boolean;
};

export type BomPlan = {
  release: BomRelease;
  quantity: number;
  subassemblies: BomRelease[];
  edges: BomEdge[];
  requirements: BomRequirement[];
};

export type BomUsage = {
  release: BomRelease;
  direct: boolean;
  substitute: boolean;
};

export type BomComparison = {
  release: BomRelease;
  subassemblies: BomRelease[];
  changes: {
    item: BomPart;
    before: Omit<BomEdge, "releaseId" | "requiredPieces"> | null;
    after: Omit<BomEdge, "releaseId" | "requiredPieces"> | null;
  }[];
};

export type BomPlanningWorkspace = {
  releases: BomRelease[];
  sites: BomSite[];
  siteId: string | null;
  plan: BomPlan | null;
  whereUsedPart: BomPart | null;
  whereUsed: BomUsage[];
  comparison: BomComparison | null;
};

export type BomPlanningError = "unavailable" | "invalid" | "limit" | "unitChanged";
export type BomPlanningResult = Result<BomPlanningWorkspace, BomPlanningError>;
