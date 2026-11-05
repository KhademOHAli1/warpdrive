import { z } from "zod";
import type { Db } from "@/db/client";
import { toRefActor } from "@/features/contacts/actorAdapters";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { nativeError } from "./nativeErrors";
import { type NativeFieldMetadata, nativeReferenceGate } from "./nativeFields";
import type { NativeFilter, NativeFilterCondition } from "./nativeFilters";

function leaves(filter: NativeFilter | NativeFilter[] | undefined): NativeFilterCondition[] {
  if (filter === undefined) return [];
  if (Array.isArray(filter)) return filter.flatMap(leaves);
  return "conditions" in filter ? leaves(filter.conditions) : [filter];
}

// A hidden linked record cannot be probed through a filter over an otherwise visible parent.
// The compiler has already bounded the tree and allowed only exact reference matches.
export async function assertNativeFilterReferences(
  db: Db,
  actor: PermSetUser,
  input: NativeFilter | NativeFilter[] | undefined,
  fields: NativeFieldMetadata[],
  signal: AbortSignal,
): Promise<void> {
  const checked = new Set<string>();
  for (const clause of leaves(input)) {
    const field = fields.find((entry) => entry.key === clause.field);
    const kind = nativeReferenceGate(field?.referenceObject);
    if (kind === undefined) continue;
    for (const value of Array.isArray(clause.value) ? clause.value : [clause.value]) {
      await assertFilterValue(db, actor, kind, value, checked, signal);
    }
  }
}

async function assertFilterValue(
  db: Db,
  actor: PermSetUser,
  kind: NonNullable<ReturnType<typeof nativeReferenceGate>>,
  value: unknown,
  checked: Set<string>,
  signal: AbortSignal,
): Promise<void> {
  const id = z.uuid().safeParse(value);
  if (!id.success) throw nativeError("workflow_native_filter_reference_unavailable");
  const key = `${kind}:${id.data.toLowerCase()}`;
  if (checked.has(key)) return;
  if (checked.size >= 100) throw nativeError("workflow_native_filter_invalid");
  const visible = await assertReferenceVisible(
    db,
    toRefActor(actor),
    { kind, id: id.data },
    signal,
  );
  if (!visible.ok) throw nativeError("workflow_native_filter_reference_unavailable");
  checked.add(key);
}
