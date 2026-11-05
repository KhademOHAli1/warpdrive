export const recordSearchLimitMax = 100;
export const recordSearchOffsetMax = 10_000;
export const recordSearchDepthMax = 3;
export const recordSearchEntryMax = 20;
export const recordPickCandidateMax = 100;

function object(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function onlyKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(raw).every((key) => typeof key === "string" && keys.includes(key));
}

function boundedScalar(raw: unknown): boolean {
  return (
    raw === null ||
    typeof raw === "boolean" ||
    (typeof raw === "number" && Number.isFinite(raw)) ||
    (typeof raw === "string" && raw.length <= 255)
  );
}

function boundedBinding(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (!object(raw)) return false;
  if (raw.kind === "reference")
    return (
      onlyKeys(raw, ["kind", "nodeId", "path"]) &&
      typeof raw.nodeId === "string" &&
      raw.nodeId.length <= 64 &&
      Array.isArray(raw.path) &&
      raw.path.length <= 8 &&
      raw.path.every((entry: unknown) => typeof entry === "string" && entry.length <= 80)
    );
  return (
    raw.kind === "value" &&
    onlyKeys(raw, ["kind", "value", "literalType"]) &&
    boundedScalar(raw.value) &&
    (raw.literalType === undefined ||
      raw.literalType === "date" ||
      raw.literalType === "instant" ||
      raw.literalType === "number")
  );
}

export function boundedRecordSearchFilter(raw: unknown): boolean {
  let remaining = recordSearchEntryMax;
  function visit(entry: unknown, depth: number): boolean {
    if (--remaining < 0 || !object(entry) || typeof entry.id !== "string" || entry.id.length > 36)
      return false;
    if (entry.kind === "condition")
      return (
        onlyKeys(entry, ["kind", "id", "field", "operator", "value"]) &&
        typeof entry.field === "string" &&
        entry.field.length <= 32 &&
        typeof entry.operator === "string" &&
        entry.operator.length <= 32 &&
        boundedBinding(entry.value)
      );
    return (
      entry.kind === "group" &&
      depth <= recordSearchDepthMax &&
      onlyKeys(entry, ["kind", "id", "combinator", "entries"]) &&
      (entry.combinator === "and" || entry.combinator === "or") &&
      Array.isArray(entry.entries) &&
      entry.entries.length > 0 &&
      entry.entries.length < recordSearchEntryMax &&
      entry.entries.every((child: unknown) => visit(child, depth + 1))
    );
  }
  return visit(raw, 1);
}

// Apply ahead of recursive JSON parsing when a definition carries lookup settings.
export function boundedRecordLookupConfig(raw: unknown): boolean {
  if (!object(raw)) return true;
  if (["filter", "orderBy", "limit", "offset"].some((key) => Object.hasOwn(raw, key)))
    return (
      onlyKeys(raw, ["entity", "filter", "orderBy", "limit", "offset"]) &&
      (raw.entity === undefined || (typeof raw.entity === "string" && raw.entity.length <= 32)) &&
      (raw.filter === undefined || boundedRecordSearchFilter(raw.filter)) &&
      (raw.orderBy === undefined ||
        (Array.isArray(raw.orderBy) &&
          raw.orderBy.length <= 3 &&
          raw.orderBy.every(
            (sort: unknown) =>
              object(sort) &&
              onlyKeys(sort, ["field", "direction"]) &&
              typeof sort.field === "string" &&
              sort.field.length <= 32 &&
              (sort.direction === "asc" || sort.direction === "desc"),
          ))) &&
      boundedBinding(raw.limit) &&
      boundedBinding(raw.offset)
    );
  if (["recordIds", "loadBalance", "strategy"].some((key) => Object.hasOwn(raw, key)))
    return (
      onlyKeys(raw, ["entity", "strategy", "recordIds", "loadBalance"]) &&
      (raw.entity === undefined || (typeof raw.entity === "string" && raw.entity.length <= 32)) &&
      (raw.strategy === undefined ||
        (typeof raw.strategy === "string" && raw.strategy.length <= 32)) &&
      (raw.recordIds === undefined ||
        (Array.isArray(raw.recordIds) &&
          raw.recordIds.length <= recordPickCandidateMax &&
          raw.recordIds.every((id: unknown) => typeof id === "string" && id.length <= 36))) &&
      (raw.loadBalance === undefined ||
        (object(raw.loadBalance) &&
          onlyKeys(raw.loadBalance, ["entity", "field"]) &&
          typeof raw.loadBalance.entity === "string" &&
          raw.loadBalance.entity.length <= 32 &&
          typeof raw.loadBalance.field === "string" &&
          raw.loadBalance.field.length <= 32))
    );
  return true;
}
