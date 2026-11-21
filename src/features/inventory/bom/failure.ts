import type { BomPlanningError } from "./contracts";

export class BomPlanningFailure extends Error {
  constructor(readonly code: BomPlanningError) {
    super(code);
  }
}

export function failBom(code: BomPlanningError): never {
  throw new BomPlanningFailure(code);
}
