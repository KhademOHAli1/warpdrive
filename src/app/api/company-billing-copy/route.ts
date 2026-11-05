import { companyBillingPrefill } from "@/features/billing/ui/companyPrefill";
import { companyResult } from "@/features/company-profile/http";
import { companyFailure } from "@/features/company-profile/policy";
import { companyAuthorized } from "@/features/company-profile/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return companyAuthorized(request, false, false, async ({ company, actor }) => {
    if (actor.type !== "admin")
      return companyResult({ ok: false, error: companyFailure("forbidden") });
    const result = await company.overview(actor);
    if (!result.ok) return companyResult(result);
    return companyResult({
      ok: true,
      value: companyBillingPrefill(result.value.legalEntities, result.value.payerPreferences),
    });
  });
}
