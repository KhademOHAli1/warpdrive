/** Keep local edits, while carrying forward untouched fields from the latest saved record. */
export function rebaseDraft<T extends object>(baseline: T, draft: T, latest: T): T {
  const merged = { ...latest };
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])) merged[key] = draft[key];
  }
  return merged;
}
