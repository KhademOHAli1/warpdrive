import { expect, it } from "vitest";
import type { RouterOutputs } from "@/lib/trpc-client";
import { buildConfigurationMetadata } from "./configurationMetadataView";

type Page = Extract<RouterOutputs["workflows"]["configuration"], { state: "page" }>;
type Options = Extract<RouterOutputs["workflows"]["configurationOptions"], { state: "page" }>;
const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const fieldId = "e96b131c-a58c-4469-84b1-81e249e653bc";
function page(overrides: Partial<Page> = {}): Page {
  return {
    state: "page",
    workflowId,
    type: "activity.create",
    version: 1,
    fingerprint: "one",
    items: [
      {
        id: fieldId,
        key: "choice",
        type: "single_option",
        name: "Choice",
        isRequired: true,
        isImportant: false,
        order: 0,
        optionCount: 2,
      },
    ],
    nextCursor: null,
    totalFields: 1,
    capabilities: { edit: true },
    executionReasons: [],
    ...overrides,
  };
}
function options(overrides: Partial<Options> = {}): Options {
  return {
    state: "page",
    workflowId,
    type: "activity.create",
    version: 1,
    fieldId,
    fingerprint: "one",
    items: [
      { id: "a", label: "First" },
      { id: "b", label: "Second" },
    ],
    nextCursor: null,
    totalOptions: 2,
    query: "",
    ...overrides,
  };
}
it("keeps a final field page incomplete until all unfiltered options are loaded", () => {
  const view = buildConfigurationMetadata(page(), [], []);
  expect(view.metadata.status).toBe("incomplete");
  expect(view.next).toEqual({ kind: "options", fieldId, cursor: undefined });
});
it("does not mistake the final filtered options search for a complete schema", () => {
  const view = buildConfigurationMetadata(
    page(),
    [],
    [
      {
        cursor: undefined,
        page: options({ query: "First", items: [{ id: "a", label: "First" }], totalOptions: 1 }),
      },
    ],
  );
  expect(view.metadata.status).not.toBe("complete");
});
it("requires the field cursor chain before accepting a required later field", () => {
  const first = page({ nextCursor: "second", totalFields: 2 });
  const later = page({
    items: [
      {
        ...first.items[0]!,
        id: "848408c6-faf7-4234-8de1-c63f1c9107dc",
        key: "required_later",
        type: "numeric",
        optionCount: 0,
      },
    ],
    totalFields: 2,
  });
  const before = buildConfigurationMetadata(first, [], []);
  expect(before.next).toEqual({ kind: "fields", cursor: "second" });
  expect(before.metadata.status).toBe("incomplete");
  const after = buildConfigurationMetadata(
    first,
    [{ cursor: "second", page: later }],
    [{ cursor: undefined, page: options() }],
  );
  expect(after.metadata.status).toBe("complete");
  expect(after.metadata.defs).toHaveLength(2);
});
it("rejects stale mixed-fingerprint continuations without discarding the first page", () => {
  const first = page({ nextCursor: "second", totalFields: 2 });
  const view = buildConfigurationMetadata(
    first,
    [{ cursor: "second", page: page({ fingerprint: "two", totalFields: 2 }) }],
    [],
  );
  expect(view.metadata.status).toBe("stale");
  expect(view.metadata.defs?.[0]?.id).toBe(fieldId);
});
it("rejects a foreign workflow option chain", () => {
  const view = buildConfigurationMetadata(
    page(),
    [],
    [{ cursor: undefined, page: options({ workflowId: "848408c6-faf7-4234-8de1-c63f1c9107dc" }) }],
  );
  expect(view.metadata.status).toBe("stale");
});
it("does not treat duplicate descriptor identities as the declared field count", () => {
  const first = page({ nextCursor: "second", totalFields: 2 });
  const view = buildConfigurationMetadata(
    first,
    [{ cursor: "second", page: page({ totalFields: 2 }) }],
    [],
  );
  expect(view.metadata.status).not.toBe("complete");
});
it("preserves native option order and repeated canonical IDs across a complete chain", () => {
  const first = options({ items: [{ id: "a", label: "First" }], nextCursor: "more" });
  const second = options({ items: [{ id: "a", label: "Repeated" }] });
  const view = buildConfigurationMetadata(
    page(),
    [],
    [
      { cursor: undefined, page: first },
      { cursor: "more", page: second },
    ],
  );
  expect(view.metadata.status).toBe("complete");
  expect(view.metadata.defs?.[0]?.options).toEqual([
    { id: "a", label: "First" },
    { id: "a", label: "Repeated" },
  ]);
});
it("accepts an authoritative empty schema without inventing defaults", () => {
  const view = buildConfigurationMetadata(page({ items: [], totalFields: 0 }), [], []);
  expect(view.metadata).toEqual({ status: "complete", defs: [], fingerprint: "one" });
  expect(view.next).toBeNull();
});
