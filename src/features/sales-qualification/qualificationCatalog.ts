import { ok, type Result } from "@/types/result";
import { buyingReadiness } from "./buyingReadiness";
import { commercialHypothesis } from "./commercialHypothesis";
import { complexPurchaseReview } from "./complexPurchaseReview";
import { customerContextReview } from "./customerContextReview";
import { discoveryConversation } from "./discoveryConversation";
import { mutualWorkingAgreement } from "./mutualWorkingAgreement";
import {
  type QualificationDefinitionProblem,
  readQualificationDefinition,
} from "./qualificationDefinition";
import type { QualificationDefinition } from "./qualificationSchemas";

export function readQualificationCatalog(): Result<
  readonly QualificationDefinition[],
  QualificationDefinitionProblem
> {
  const definitions: QualificationDefinition[] = [];
  const sources = [
    buyingReadiness,
    complexPurchaseReview,
    customerContextReview,
    discoveryConversation,
    commercialHypothesis,
    mutualWorkingAgreement,
  ];
  for (const source of sources) {
    const parsed = readQualificationDefinition(JSON.stringify(source));
    if (!parsed.ok) return parsed;
    definitions.push(parsed.value);
  }
  return ok(Object.freeze(definitions));
}
