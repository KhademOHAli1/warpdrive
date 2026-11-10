// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import {
  listCursor,
  listOrgId,
  listOwnerId,
  listProjectId,
  listTitle,
  listView,
  listViewProps,
  renderListView,
  repositoryPage,
} from "./ProjectListView.test-support";
import { projectListRequestSchema } from "./persistence/projectListInput";
import { projectListUiPage } from "./projectListUiTypes";

afterEach(cleanup);

describe("controlled private project list", () => {
  it.each([
    ["en", "Projects", "Planned", "Next page", "ltr"],
    ["de", "Projekte", "Geplant", "Nächste Seite", "ltr"],
    ["fa", "پروژه‌ها", "برنامه‌ریزی‌شده", "صفحهٔ بعد", "rtl"],
  ] as const)(
    "uses natural %s labels, direction and protected plain text",
    (locale, heading, planned, next, dir) => {
      const props = listViewProps();
      const view = renderListView(props, locale);
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: planned })).toBeChecked();
      expect(screen.getByRole("region")).toHaveAttribute("dir", dir);
      expect(screen.getByRole("region")).toHaveClass("ph-block-email", "ph-no-capture");
      expect(screen.getByText(listTitle).tagName).toBe("BDI");
      expect(screen.getByRole("button", { name: next })).toHaveAttribute("type", "button");
      for (const secret of [
        listProjectId,
        listOwnerId,
        listOrgId,
        listCursor,
        "permitted-context-1",
        "request-1",
      ])
        expect(view.container.innerHTML).not.toContain(secret);
      fireEvent.click(screen.getByRole("button", { name: listTitle }));
      expect(props.onOpenProject).toHaveBeenCalledExactlyOnceWith(listProjectId);
    },
  );

  it("explicitly minimizes repository rows and never interprets a title as markup", () => {
    const raw = {
      ...repositoryPage,
      items: repositoryPage.items.map((item) => ({
        ...item,
        title: "<img src=x onerror=secret>",
        privatePayload: "SECRET",
        value: "987654",
      })),
    };
    const page = projectListUiPage(raw);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(["id", "state", "title"]);
    const props = listViewProps();
    const view = renderListView({
      ...props,
      view: {
        contextKey: props.contextKey,
        requestId: props.requestId,
        request: props.request,
        kind: "ready",
        page,
      },
    });
    expect(screen.getByText("<img src=x onerror=secret>")).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.innerHTML).not.toContain("SECRET");
    expect(view.container.innerHTML).not.toContain("987654");
  });

  it("shows loading without a stale page or next-page action", () => {
    renderListView(listViewProps({ view: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("distinguishes an empty successful page from loading or failure", () => {
    const props = listViewProps();
    renderListView({
      ...props,
      view: {
        contextKey: props.contextKey,
        requestId: props.requestId,
        request: props.request,
        kind: "ready",
        page: { items: [], nextCursor: null },
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("No projects match these filters.");
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["invalid_project_list_input", "project_unavailable", "unknown"] as const)(
    "keeps %s failure generic and retries the current controlled request",
    (error) => {
      const props = listViewProps();
      renderListView({
        ...props,
        view: {
          contextKey: props.contextKey,
          requestId: props.requestId,
          request: props.request,
          kind: "error",
          error,
        },
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Projects could not be loaded. Try again.",
      );
      expect(screen.queryByText(error)).not.toBeInTheDocument();
      expect(screen.queryByText(listTitle)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(props.onRetry).toHaveBeenCalledExactlyOnceWith(props.request);
      expect(props.onRequestChange).not.toHaveBeenCalled();
    },
  );

  it("requests the exact next cursor while retaining filters and page size", () => {
    const props = listViewProps();
    renderListView(props);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(props.onRequestChange).toHaveBeenCalledExactlyOnceWith({
      ...props.request,
      cursor: listCursor,
    });
    expect(props.request.cursor).toBeNull();
    expect(screen.getByText(listTitle)).toBeInTheDocument();
  });

  it("resets continuation on a state change and preserves owner, anchor and page size", () => {
    const request = projectListRequestSchema.parse({
      filters: {
        schemaVersion: 1,
        ownerUserId: listOwnerId,
        anchor: { kind: "organization", id: listOrgId },
      },
      pageSize: 50,
      cursor: listCursor,
    });
    const props = listViewProps({ request });
    renderListView(props);
    fireEvent.click(screen.getByRole("checkbox", { name: "Completed" }));
    expect(props.onRequestChange).toHaveBeenCalledExactlyOnceWith({
      ...request,
      cursor: null,
      filters: { ...request.filters, states: ["planned", "active", "on-hold", "completed"] },
    });
    expect(request.filters.states).toEqual(["planned", "active", "on-hold"]);
  });

  it("prevents an empty state filter and keeps every field ID unique across two lists", () => {
    const request = projectListRequestSchema.parse({
      filters: { schemaVersion: 1, states: ["active"] },
    });
    const props = listViewProps({ request });
    const rendered = render(
      <>
        {listView(props)}
        {listView(listViewProps())}
      </>,
    );
    const active = screen.getAllByRole("checkbox", { name: "Active" })[0];
    expect(active).toBeDisabled();
    if (active) fireEvent.click(active);
    expect(props.onRequestChange).not.toHaveBeenCalled();
    const ids = [...rendered.container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const checkbox of screen.getAllByRole("checkbox"))
      expect(rendered.container.querySelector(`label[for="${checkbox.id}"]`)).not.toBeNull();
  });
});
