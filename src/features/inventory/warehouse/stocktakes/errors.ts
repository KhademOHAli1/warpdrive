import type { StocktakeError } from "./contracts";

export class StocktakeFailure extends Error {
  constructor(readonly code: StocktakeError) {
    super(code);
  }
}

export function failStocktake(reason: StocktakeError): never {
  throw new StocktakeFailure(reason);
}
