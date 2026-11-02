// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ email: { templates: { list: { invalidate: () => undefined } } } }),
    email: {
      templates: {
        list: { useQuery: () => ({ data: [] }) },
        get: { useQuery: () => ({ data: undefined }) },
      },
      mergeContext: { useQuery: () => ({ data: {}, isPending: false }) },
      signatures: { list: { useQuery: () => ({ data: [] }) } },
    },
    contacts: { listPeople: { useQuery: () => ({ data: { rows: [], total: 0 } }) } },
    activities: { listTypes: { useQuery: () => ({ data: [] }) } },
  },
}));

const sendEmailMock = vi.fn<() => Promise<{ ok: boolean }>>(() => Promise.resolve({ ok: true }));
vi.mock("@/features/email/actions", () => ({ sendEmail: () => sendEmailMock() }));

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

vi.mock("@/features/activities/actions", () => ({
  createActivityAction: () => Promise.resolve({ ok: true, value: { id: "act-stub" } }),
  completeActivityAction: () => Promise.resolve({ ok: true, value: { id: "act-stub" } }),
}));

vi.mock("@/features/files/serverActions", () => ({
  requestUploadAction: () =>
    Promise.resolve({
      ok: true,
      value: { fileId: "attach-file-1", post: { url: "https://fake/up", fields: {} } },
    }),
  confirmUploadAction: () => Promise.resolve({ ok: true }),
}));

vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));

vi.mock("../folderActions", () => ({
  saveDraftAction: () => Promise.resolve({ ok: true, value: { id: "saved-draft" } }),
  deleteDraftAction: () => Promise.resolve({ ok: true, value: { id: "saved-draft" } }),
  cancelOutboxAction: () => Promise.resolve({ ok: false, error: { id: "E_GMAIL_017" } }),
}));

import { Composer } from "./Composer";
import { composerMailboxMessages } from "./mailboxMessages";

// The send action arms an 8s deadline of its own, so a slow Gmail send rejects instead of
// returning a failed Result. An escaping rejection left `sending` stuck true, which greyed
// out Send permanently with no banner to explain it. This is the user-visible half of that.
describe("Composer when the send action rejects", () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function abortError(): Error {
    const e = new Error("The operation was aborted due to timeout");
    e.name = "AbortError";
    return e;
  }

  it("locks the submitted request and offers status checking when the answer is lost", async () => {
    sendEmailMock.mockImplementation(() => Promise.reject(abortError()));
    render(
      <Composer
        accountId="a1"
        context={{ kind: "deal", dealId: "d1", defaultTo: "recipient@x.com" }}
      />,
    );

    const send = screen.getByRole("button", { name: /^send$/i });
    fireEvent.click(send);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(composerMailboxMessages("en").unknownDescription)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: composerMailboxMessages("en").checkStatus }),
    ).toBeEnabled();
    expect(send).toBeDisabled();
  });
});
