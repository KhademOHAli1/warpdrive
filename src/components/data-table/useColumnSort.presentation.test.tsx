// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ColumnSort, useColumnSort } from "./useColumnSort";

type Field = "createdAt" | "name" | "value";
const FALLBACK: ColumnSort<Field> = { field: "createdAt", dir: "desc" };

function replace(state: unknown, sort: ColumnSort<Field> | null): void {
  const candidate = state as { replace?: (next: ColumnSort<Field> | null) => void };
  expect(candidate.replace).toBeTypeOf("function");
  candidate.replace?.(sort);
}

describe("useColumnSort presentation replacement", () => {
  it("replaces an existing user sort with the saved-view sort", () => {
    const { result } = renderHook(() => useColumnSort<Field>(FALLBACK));
    void act(() => result.current.cycle("value"));
    void act(() => replace(result.current, { field: "name", dir: "desc" }));
    expect(result.current.sort).toEqual({ field: "name", dir: "desc" });
    expect(result.current.effective).toEqual({ field: "name", dir: "desc" });
  });

  it("clears a temporary sort and uses the current fallback when restoring the baseline", () => {
    const { result, rerender } = renderHook(({ fallback }) => useColumnSort<Field>(fallback), {
      initialProps: { fallback: FALLBACK },
    });
    void act(() => replace(result.current, { field: "name", dir: "asc" }));
    const fallback: ColumnSort<Field> = { field: "value", dir: "desc" };
    rerender({ fallback });
    void act(() => replace(result.current, null));
    expect(result.current.sort).toBeNull();
    expect(result.current.effective).toEqual(fallback);
  });

  it("continues the normal header cycle after replacement without mutating the captured sort", () => {
    const saved: ColumnSort<Field> = { field: "name", dir: "desc" };
    const { result } = renderHook(() => useColumnSort<Field>(FALLBACK));
    void act(() => replace(result.current, saved));
    void act(() => result.current.cycle("name"));
    expect(result.current.sort).toBeNull();
    expect(saved).toEqual({ field: "name", dir: "desc" });
    void act(() => result.current.cycle("value"));
    expect(result.current.sort).toEqual({ field: "value", dir: "asc" });
  });
});
