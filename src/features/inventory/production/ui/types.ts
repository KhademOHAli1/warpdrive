import { custodyRemaining, type SubcontractEditor } from "../../subcontract/ui/types";
import type {
  ProductionBuild,
  ProductionDetail,
  ProductionIntent,
  ProductionMaterial,
  ProductionOutput,
  ProductionPosition,
  ProductionQuery,
  ProductionWorkspace,
  SubcontractView,
} from "../contracts";

export type ProductionDialog = {
  pending: boolean;
  blocked: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: ProductionIntent) => void;
};

export type ProductionEditor =
  | { type: "createBuild" }
  | SubcontractEditor
  | {
      type:
        | "schedule"
        | "issue"
        | "hold"
        | "resume"
        | "autoAllocate"
        | "startBatch"
        | "cancelBuild";
      build: ProductionDetail;
    }
  | { type: "allocate"; build: ProductionDetail; material: ProductionMaterial }
  | {
      type: "deallocate";
      build: ProductionDetail;
      material: ProductionMaterial;
      position: ProductionPosition;
      quantity: number;
    }
  | {
      type: "completeBatch" | "scrapBatch" | "cancelBatch" | "reverseOutput";
      build: ProductionDetail;
      output: ProductionOutput;
    };

export type OpenProductionEditor = (
  event: React.MouseEvent<HTMLButtonElement>,
  editor: ProductionEditor,
) => void;

export function productionHref({ siteId, buildId, releaseId }: ProductionQuery = {}) {
  const search = new URLSearchParams();
  if (siteId !== undefined) search.set("siteId", siteId);
  if (buildId !== undefined) search.set("buildId", buildId);
  if (releaseId !== undefined) search.set("releaseId", releaseId);
  return search.size === 0 ? "/inventory/production" : `/inventory/production?${search.toString()}`;
}

export function siteCanPlan(site: ProductionWorkspace["sites"][number]) {
  return site.canManage && site.locations.length > 0;
}

export function productionCanPlan(workspace: ProductionWorkspace | null, siteId?: string) {
  return (
    workspace !== null &&
    workspace.releases.length > 0 &&
    workspace.sites.some(
      (site) => (siteId === undefined || site.id === siteId) && siteCanPlan(site),
    )
  );
}

export function buildCanChange(build: ProductionBuild) {
  return build.canManage && build.status !== "closed" && build.status !== "cancelled";
}

export function materialRemaining(
  { id, demand, allocated, consumed }: ProductionMaterial,
  subcontract: SubcontractView | null = null,
) {
  const dispatched =
    subcontract?.custody.reduce(
      (quantity, dispatch) =>
        dispatch.materialId === id ? quantity + custodyRemaining(dispatch) : quantity,
      0,
    ) ?? 0;
  return Math.max(0, demand - allocated - consumed - dispatched);
}

export function batchRemaining(build: ProductionDetail) {
  const wip = build.outputs.reduce(
    (quantity, batch) => quantity + (batch.status === "wip" ? batch.quantity : 0),
    0,
  );
  return Math.max(0, build.quantity - build.completed - build.scrapped - wip);
}
