import type { QualityError } from "./contracts";

export class QualityFailure extends Error {
  constructor(readonly code: QualityError) {
    super(code);
  }
}

export function failQuality(code: QualityError): never {
  throw new QualityFailure(code);
}
