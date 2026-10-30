// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxLocation } from "@/features/email/inboxLocation";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("@/features/email/InboxWorkspace", () => ({
  InboxWorkspace: ({
    location,
    onNavigate,
  }: {
    location: InboxLocation;
    onNavigate: (next: InboxLocation, replace?: boolean) => void;
  }) => (
    <>
      <output>{JSON.stringify(location)}</output>
      <button
        type="button"
        onClick={() =>
          onNavigate({ ...location, threadId: "00000000-0000-4000-8000-000000000001" })
        }
      >
        Open
      </button>
      <button type="button" onClick={() => onNavigate({ ...location, query: "Updated" }, true)}>
        Search
      </button>
    </>
  ),
}));

import { InboxListClient } from "./InboxListClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  params = new URLSearchParams();
});
describe("InboxListClient URL state", () => {
  it("restores folder, search and filters without automatically selecting a thread", () => {
    params = new URLSearchParams("folder=archive&q=Budget&view=waiting&attachments=1");
    render(<InboxListClient selfActorId="u1" folder="archive" />);
    expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toMatchObject({
      folder: "archive",
      query: "Budget",
      view: "waiting",
      threadId: null,
      attributes: { hasAttachment: true },
    });
  });
  it("keeps the list mounted and preserves filters when a conversation opens", () => {
    params = new URLSearchParams("folder=archive&q=Budget&view=unread");
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    render(<InboxListClient selfActorId="u1" folder="archive" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("folder=archive&q=Budget&view=unread&thread="),
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenCalledWith(null, "", "/inbox?folder=archive&q=Updated&view=unread");
  });
});
