// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import { listTitle, listView, listViewProps, renderListView } from "./ProjectListView.test-support";
import { projectListRequestSchema } from "./persistence/projectListInput";

afterEach(cleanup);

describe("controlled list view provenance and lifecycle", () => {
  it("hides an old filter result even if the parent accidentally reuses a request ID", () => {
    const old = listViewProps();
    const view = renderListView(old);
    const request = projectListRequestSchema.parse({
      filters: { schemaVersion: 1, states: ["active"] },
    });
    view.rerender(listView({ ...old, request }));
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Planned" })).not.toBeChecked();
  });

  it("does not display a previous page response under the current next-page request", () => {
    const old = listViewProps();
    const view = renderListView(old);
    const current = {
      ...old,
      requestId: "page-two-attempt",
      request: { ...old.request, cursor: "current-page-cursor" },
    };
    view.rerender(listView(current));
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    view.rerender(
      listView({
        ...current,
        view: {
          contextKey: current.contextKey,
          requestId: current.requestId,
          request: current.request,
          kind: "ready",
          page: {
            items: [
              {
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                title: "Current page",
                state: "active",
              },
            ],
            nextCursor: null,
          },
        },
      }),
    );
    expect(screen.getByRole("button", { name: "Current page" })).toBeInTheDocument();
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
  });

  it("rejects an old A result after A→B→A and after remount until the new A result arrives", () => {
    const original = listViewProps();
    const first = renderListView(original);
    const changed = projectListRequestSchema.parse({
      filters: { schemaVersion: 1, states: ["completed"] },
    });
    first.rerender(listView({ ...original, requestId: "attempt-B", request: changed }));
    const returned = { ...original, requestId: "new-attempt-A" };
    first.rerender(listView(returned));
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    first.unmount();
    const remounted = renderListView(returned);
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    remounted.rerender(listView(listViewProps({ requestId: "new-attempt-A" })));
    expect(screen.getByText(listTitle)).toBeInTheDocument();
  });

  it("removes all private content/actions on read loss and rejects the former context after restoration", () => {
    const original = listViewProps();
    const view = renderListView(original);
    view.rerender(listView({ ...original, canRead: false }));
    expect(screen.getByRole("alert")).toHaveClass("ph-block-email", "ph-no-capture");
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(listView({ ...original, contextKey: "different-permitted-actor" }));
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    expect(original.onOpenProject).not.toHaveBeenCalled();
    expect(original.onRetry).not.toHaveBeenCalled();
  });

  it("preserves controlled selection, page and callbacks during a locale switch", () => {
    const props = listViewProps();
    const view = renderListView(props, "en");
    view.rerender(listView(props, "fa"));
    expect(screen.getByRole("heading", { name: "پروژه‌ها" })).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(listTitle)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "فعال" })).toBeChecked();
    expect(props.onRequestChange).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
  });
});
