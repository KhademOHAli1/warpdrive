// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_REF_LABELS } from "@/features/custom-fields/refLabelsContext";
import { type ContactListPage, useContactListPaging } from "./useContactListPaging";

afterEach(cleanup);
type Row = { id: string; name: string };
const initial = [{ id: "initial", name: "Initial" }];
const messages = { reloadError: "Reload failed", moreError: "Next page failed" };

it("keeps newer search results when an older request finishes last", async () => {
  let finishOld: (page: ContactListPage<Row>) => void = () => undefined;
  const oldFetch = vi.fn(
    () =>
      new Promise<ContactListPage<Row>>((resolve) => {
        finishOld = resolve;
      }),
  );
  const newFetch = vi.fn(() => Promise.resolve({ rows: [{ id: "new", name: "New" }], total: 1 }));
  const { result, rerender } = renderHook(
    ({ fetchPage }: { fetchPage: (offset: number) => Promise<ContactListPage<Row>> }) =>
      useContactListPaging({
        initial,
        initialTotal: 1,
        initialRefLabels: EMPTY_REF_LABELS,
        fetchPage,
        ...messages,
      }),
    { initialProps: { fetchPage: oldFetch } },
  );
  let oldRequest = Promise.resolve();
  act(() => {
    oldRequest = result.current.reload();
  });
  rerender({ fetchPage: newFetch });
  await act(() => result.current.reload());
  await act(async () => {
    finishOld({ rows: [{ id: "old", name: "Old" }], total: 1 });
    await oldRequest;
  });
  expect(result.current.rows.map((row) => row.id)).toEqual(["new"]);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
});

it("deduplicates appended rows and retains reference labels from both pages", async () => {
  const fetchPage = vi.fn(() =>
    Promise.resolve({
      rows: [...initial, { id: "second", name: "Second" }],
      total: 2,
      refLabels: { user: { u2: "Second owner" }, person: {}, org: {} },
    }),
  );
  const { result } = renderHook(() =>
    useContactListPaging({
      initial,
      initialTotal: 2,
      initialRefLabels: { user: { u1: "First owner" }, person: {}, org: {} },
      fetchPage,
      ...messages,
    }),
  );
  await act(() => result.current.loadMore());
  expect(result.current.rows.map((row) => row.id)).toEqual(["initial", "second"]);
  expect(result.current.refLabels.user).toEqual({ u1: "First owner", u2: "Second owner" });
});

it("refreshes the current view when the server returns a new seed after creation", async () => {
  const fetchPage = vi.fn(() =>
    Promise.resolve({ rows: [{ id: "created", name: "Created" }], total: 1 }),
  );
  const { result, rerender } = renderHook(
    ({ seed }) =>
      useContactListPaging({
        initial: seed,
        initialTotal: 1,
        initialRefLabels: EMPTY_REF_LABELS,
        fetchPage,
        ...messages,
      }),
    { initialProps: { seed: initial } },
  );
  expect(fetchPage).not.toHaveBeenCalled();
  rerender({ seed: [{ id: "created", name: "Created" }] });
  await waitFor(() => expect(result.current.rows[0]?.id).toBe("created"));
  expect(fetchPage).toHaveBeenCalledWith(0);
});
