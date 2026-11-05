import { z } from "zod";
import { boundedConditionConfig, conditionRecord } from "./conditionExpressionBudget";

export const ifElseBranchLimit = 8;
const branchIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const branchPortPattern = /^branch:[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export type BranchPort = `branch:${string}`;
export const branchPortSchema = z.custom<BranchPort>(
  (value) => typeof value === "string" && branchPortPattern.test(value),
);

export function branchPort(id: string): BranchPort {
  return `branch:${id}`;
}

function branchId(raw: unknown): raw is string {
  return typeof raw === "string" && branchIdPattern.test(raw);
}

export function readIfElseEnvelope(raw: unknown) {
  if (
    !conditionRecord(raw) ||
    Object.keys(raw).length !== 2 ||
    !Object.hasOwn(raw, "branches") ||
    !Object.hasOwn(raw, "fallbackId") ||
    !branchId(raw.fallbackId) ||
    !Array.isArray(raw.branches) ||
    raw.branches.length === 0 ||
    raw.branches.length > ifElseBranchLimit
  )
    return null;
  const ids = new Set([raw.fallbackId]);
  const branches: { id: string; predicate: unknown }[] = [];
  for (const branch of raw.branches) {
    if (
      !conditionRecord(branch) ||
      Object.keys(branch).length !== 2 ||
      !Object.hasOwn(branch, "id") ||
      !Object.hasOwn(branch, "predicate") ||
      !branchId(branch.id) ||
      ids.has(branch.id)
    )
      return null;
    ids.add(branch.id);
    branches.push({ id: branch.id, predicate: branch.predicate });
  }
  return { branches, fallbackId: raw.fallbackId };
}

export function ifElsePorts(raw: unknown): BranchPort[] {
  const envelope = readIfElseEnvelope(raw);
  if (envelope === null) return [];
  return [...envelope.branches.map(({ id }) => branchPort(id)), branchPort(envelope.fallbackId)];
}

export function ifElsePortDetails(raw: unknown, port: string) {
  const ports: readonly string[] = ifElsePorts(raw);
  const index = ports.indexOf(port);
  return index === -1 ? null : { index, count: ports.length, fallback: index === ports.length - 1 };
}

export function boundedIfElsePredicate(raw: unknown): boolean {
  return (
    conditionRecord(raw) &&
    Object.hasOwn(raw, "defaultPort") &&
    raw.defaultPort === "false" &&
    boundedConditionConfig(raw)
  );
}

// Run before the definition's recursive JSON parser. Each route has the
// existing group budget, and the envelope independently bounds route count.
export function boundedIfElseConfig(raw: unknown): boolean {
  const envelope = readIfElseEnvelope(raw);
  return envelope?.branches.every(({ predicate }) => boundedIfElsePredicate(predicate)) ?? false;
}
