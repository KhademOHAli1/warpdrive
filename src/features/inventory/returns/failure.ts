import type { ReturnError } from "./contracts";

export class ReturnFailure extends Error {
  constructor(readonly code: ReturnError) {
    super(code);
  }
}

export function failReturn(code: ReturnError): never {
  throw new ReturnFailure(code);
}
