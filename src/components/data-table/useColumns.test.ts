// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "./columnModel";
import { useColumns } from "./useColumns";

const CATALOG: readonly ColumnDef[] = [
  { key: "title", header: "Title", pinned: true, defaultVisible: true },
  { key: "org", header: "Organization", defaultVisible: true },
  { key: "value", header: "Value", defaultVisible: false },
];

describe("useColumns", () => {
  it("seeds from the initial order and exposes visible descriptors in order", () => {
    const { result } = renderHook(() => useColumns(CATALOG, ["title", "value"]));
    expect(result.current.order).toEqual(["title", "value"]);
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual(["title", "value"]);
    expect(result.current.visibleKeys.has("value")).toBe(true);
  });

  it("toggle shows/hides a column; reorder moves it", () => {
    const { result } = renderHook(() => useColumns(CATALOG, undefined));
    void act(() => {
      result.current.toggle("value");
    });
    expect(result.current.order).toEqual(["title", "org", "value"]);
    void act(() => {
      result.current.reorder("value", "org");
    });
    expect(result.current.order).toEqual(["title", "value", "org"]);
  });
});

describe("useColumns presentation replacement", () => {
  function replace(state: unknown, order: readonly string[]): void {
    const candidate = state as { replace?: (next: readonly string[]) => void };
    expect(candidate.replace).toBeTypeOf("function");
    candidate.replace?.(order);
  }

  it("replaces the complete visible order rather than merging with the previous view", () => {
    const { result } = renderHook(() => useColumns(CATALOG, ["title", "org"]));
    void act(() => replace(result.current, ["title", "value"]));
    expect(result.current.order).toEqual(["title", "value"]);
    expect([...result.current.visibleKeys]).toEqual(["title", "value"]);
    expect(result.current.visibleColumns.map((column) => column.key)).toEqual(["title", "value"]);
  });

  it("keeps the pinned column and applies the existing catalog normalization", () => {
    const next = ["value", "unknown", "value"];
    const { result } = renderHook(() => useColumns(CATALOG, undefined));
    void act(() => replace(result.current, next));
    expect(result.current.order).toEqual(["title", "value"]);
    expect(next).toEqual(["value", "unknown", "value"]);
  });

  it("restores the personal baseline after temporary saved-view changes", () => {
    const baseline = ["title", "org"];
    const { result } = renderHook(() => useColumns(CATALOG, baseline));
    void act(() => replace(result.current, ["title", "value"]));
    void act(() => result.current.toggle("org"));
    void act(() => replace(result.current, baseline));
    expect(result.current.order).toEqual(baseline);
    expect(result.current.visibleKeys.has("value")).toBe(false);
  });
});
