import type {
  ProductionDetail,
  ProductionMaterial,
  ProductionOutput,
  SubcontractOptions,
  SubcontractView,
} from "../../production/contracts";

export type SubcontractDispatch = SubcontractView["custody"][number];

export type SubcontractEditor =
  | { type: "linkSubcontract"; build: ProductionDetail; options: SubcontractOptions }
  | { type: "dispatchSubcontract"; build: ProductionDetail; link: SubcontractView }
  | { type: "returnSubcontractMaterial"; build: ProductionDetail; dispatch: SubcontractDispatch }
  | { type: "releaseSubcontractOutput"; build: ProductionDetail; output: ProductionOutput };

export function custodyRemaining({ quantity, consumed, returned }: SubcontractDispatch) {
  return Math.max(0, quantity - consumed - returned);
}

export function companyProvides(link: SubcontractView | null, material: ProductionMaterial) {
  return link === null || link.companyMaterialIds.includes(material.id);
}

export function availableDispatches(build: ProductionDetail, link: SubcontractView) {
  return build.materials
    .filter((material) => companyProvides(link, material) && !material.consumable)
    .flatMap(({ id, part, allocations }) =>
      allocations.map(({ position, quantity }) => ({
        key: `${id}:${position.id}`,
        materialId: id,
        part,
        position,
        quantity,
      })),
    );
}

export function subcontractAllowsCancel(build: ProductionDetail) {
  const link = build.subcontract;
  return (
    link === null ||
    (link.orderStatus === "cancelled" &&
      !link.custody.some((dispatch) => custodyRemaining(dispatch) > 0) &&
      !build.outputs.some(({ status }) => status === "wip"))
  );
}
