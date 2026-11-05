import { companyBody, companyResult } from "../http";
import { companyCapabilities, companyFailure } from "../policy";
import { companyAuthorized } from "../runtime";
import { lookupCommandSchema } from "./contracts";
import { readProposal, signProposal } from "./proposals";
import { checkVies, searchGleif } from "./providers";
/** Outbound providers are fixed. No website/domain fetch or browser-supplied provider endpoint. */
export function lookupPost(request: Request): Promise<Response> {
  return companyAuthorized(request, true, false, async ({ company, actor }, signal) => {
    if (!companyCapabilities(actor).manageLegal)
      return companyResult({ ok: false, error: companyFailure("forbidden") });
    const bytes = await companyBody(request, 40000, signal);
    if (!bytes.ok) return companyResult(bytes);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.value));
    } catch {
      return companyResult({ ok: false, error: companyFailure("invalid_input") });
    }
    const parsed = lookupCommandSchema.safeParse(input);
    if (!parsed.success)
      return companyResult({ ok: false, error: companyFailure("invalid_input") });
    const command = parsed.data;
    if (command.action === "check_vat")
      return companyResult(await checkVies(command.country, command.vatNumber, signal));
    const overview = await company.overview(actor);
    if (!overview.ok) return companyResult(overview);
    const scope = overview.value.workspaceScope;
    if (command.action === "search") {
      const result = await searchGleif(command.query, command.country, signal);
      if (!result.ok) return companyResult(result);
      return companyResult({
        ok: true,
        value: result.value.map((candidate) => ({
          ...candidate,
          token: signProposal(candidate, actor.id, scope),
        })),
      });
    }
    // An expired token can only recover an already committed matching immutable operation.
    const previous = await company.operation(actor, command.requestId);
    const proposal = readProposal(command.token, actor.id, scope, Date.now(), previous.ok);
    if (!proposal.ok) return companyResult(proposal);
    return companyResult(
      await company.execute(
        actor,
        {
          action: "save_legal_entity",
          requestId: command.requestId,
          expectedRevision: 0,
          id: null,
          data: proposal.value.data,
        },
        {
          kind: "registry",
          provider: "GLEIF",
          checkedAt: proposal.value.checkedAt,
          verification: "provider_checked",
          checkedFields: [
            "legalName",
            "country",
            "registeredAddress",
            "registrationNumber",
            "registerAuthority",
          ],
        },
      ),
    );
  });
}
