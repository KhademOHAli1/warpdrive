import { err, ok, type Result } from "@/types/result";
import {
  type ConditionExpressionIssue,
  type ConditionParseMode,
  parseConditionConfig,
} from "./conditionExpression";
import { boundedIfElsePredicate, readIfElseEnvelope } from "./ifElseBudget";
import type { WorkflowNode } from "./schemas";

type NodeConfig = WorkflowNode["config"];
export type IfElseBranch = { id: string; predicate: NodeConfig };
export type IfElseConfig = { branches: IfElseBranch[]; fallbackId: string };

export function newIfElseBranch(id: string): IfElseBranch {
  return {
    id,
    predicate: {
      defaultPort: "false",
      expression: {
        kind: "group",
        id: "rule_group",
        operator: "and",
        children: [{ kind: "predicate", id: "rule_1", operator: "equals" }],
      },
    },
  };
}

export function newIfElseConfig(): IfElseConfig {
  return { branches: [newIfElseBranch("if")], fallbackId: "else" };
}

export function branchPath(index: number): readonly string[] {
  return ["branches", String(index), "predicate"];
}

export function parseIfElseConfig(
  raw: unknown,
  mode: ConditionParseMode,
): Result<IfElseConfig, ConditionExpressionIssue[]> {
  const envelope = readIfElseEnvelope(raw);
  if (envelope === null) return err([{ path: [], code: "invalid_value" }]);
  const branches: IfElseBranch[] = [];
  const issues: ConditionExpressionIssue[] = [];
  for (const [index, branch] of envelope.branches.entries()) {
    const path = branchPath(index);
    if (!boundedIfElsePredicate(branch.predicate)) {
      issues.push({ path, code: "invalid_value" });
      continue;
    }
    const parsed = parseConditionConfig(branch.predicate, mode);
    if (!parsed.ok)
      issues.push(...parsed.error.map((issue) => ({ ...issue, path: [...path, ...issue.path] })));
    else if (parsed.value.kind === "grouped")
      // The shared parser has already validated and cloned the JSON.
      branches.push({ id: branch.id, predicate: parsed.value.config as unknown as NodeConfig });
    else issues.push({ path, code: "invalid_value" });
  }
  return issues.length > 0 ? err(issues) : ok({ branches, fallbackId: envelope.fallbackId });
}
