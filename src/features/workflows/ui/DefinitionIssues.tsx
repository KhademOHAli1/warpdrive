"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { displayNodeName } from "../nodeNames";
import type { DefinitionIssue, WorkflowDefinition } from "../schemas";

const issueKeys: Record<
  string,
  "issueDisconnected" | "issueMapping" | "issueType" | "issueBranch" | "issueCycle" | "issue"
> = {
  unreachable: "issueDisconnected",
  unavailable_reference: "issueMapping",
  unknown_output: "issueMapping",
  type_mismatch: "issueType",
  incomplete_branch: "issueBranch",
  cycle: "issueCycle",
};
export function DefinitionIssues({
  definition,
  issues,
  onSelect,
}: {
  definition: WorkflowDefinition;
  issues: DefinitionIssue[];
  onSelect: (id: string) => void;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  return (
    <>
      {issues.length > 0 && (
        <div role="alert" className="border-t bg-destructive/5 p-5 text-sm">
          <p className="font-medium text-destructive">{t("issues", { count: issues.length })}</p>
          <ul className="mt-2 space-y-1">
            {[
              ...new Map(
                issues.map((issue) => [
                  issue.code + "-" + (issue.nodeId ?? "") + "-" + (issue.field ?? ""),
                  issue,
                ]),
              ).entries(),
            ].map(([key, issue]) => {
              const affected = definition.nodes.find((item) => item.id === issue.nodeId);
              return (
                <li key={key}>
                  {affected !== undefined && (
                    <Button variant="ghost" size="sm" onClick={() => onSelect(affected.id)}>
                      {displayNodeName(affected, locale)}
                    </Button>
                  )}
                  <span className="text-muted-foreground">
                    {t(issueKeys[issue.code] ?? "issue")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
