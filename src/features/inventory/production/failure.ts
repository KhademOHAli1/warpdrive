import type { ProductionError } from "./contracts";

export class ProductionFailure extends Error {
  constructor(readonly code: ProductionError) {
    super(code);
  }
}

export function failProduction(code: ProductionError): never {
  throw new ProductionFailure(code);
}
