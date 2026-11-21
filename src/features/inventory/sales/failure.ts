import type { SalesError } from "./contracts";

export class SalesFailure extends Error {
  constructor(readonly code: SalesError) {
    super(code);
  }
}

export function failSales(code: SalesError): never {
  throw new SalesFailure(code);
}
