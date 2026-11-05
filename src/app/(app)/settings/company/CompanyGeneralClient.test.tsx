// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyCommandSchema, companyOverviewSchema } from "@/features/company-profile/contracts";
import { CompanyGeneralClient } from "./CompanyGeneralClient";

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const overview = companyOverviewSchema.parse({
  workspaceScope: "11111111-1111-4111-8111-111111111111",
  details: { companyName: "Acme" },
  detailsRevision: 0,
  branding: { iconUrl: null, logoUrl: null, foregroundColor: "#000000" },
  brandingRevision: 0,
  baseCurrency: "EUR",
  legalEntities: [],
  payerPreferences: null,
  payerRevision: null,
  capabilities: { manageProfile: true, manageLegal: false },
  confirmedAt: null,
  provenance: null,
});
function response(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
const fetchMock = vi.fn<typeof fetch>();
const saved = {
  ...overview,
  detailsRevision: 1,
  details: { ...overview.details, companyName: "New company" },
};
async function edit() {
  render(<CompanyGeneralClient actorId="actor" />);
  fireEvent.change(await screen.findByLabelText("Company name"), {
    target: { value: "New company" },
  });
}
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(response(overview));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("CompanyGeneralClient", () => {
  it("offers optional company context and the work-profile setup from Workspace details", async () => {
    render(<CompanyGeneralClient actorId="actor" />);
    expect(await screen.findByLabelText("Website")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Work profile" })).toHaveAttribute(
      "href",
      "/settings/company/work-profile",
    );
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.queryByLabelText("Base currency")).not.toBeInTheDocument();
  });
  it("keeps a dirty draft on cancel and replays the original navigation only after confirmation", async () => {
    await edit();
    const link = screen.getByRole("link", { name: "Work profile" });
    const follow = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", follow);

    fireEvent.click(link);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Leave this page without saving the draft?",
    );
    expect(follow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Company name")).toHaveValue("New company");
    expect(follow).not.toHaveBeenCalled();

    fireEvent.click(link);
    fireEvent.click(screen.getByRole("button", { name: "Leave page" }));
    await waitFor(() => expect(follow).toHaveBeenCalledTimes(1));
  });
  it("submits full typed context with current revision and UUID", async () => {
    fetchMock.mockResolvedValueOnce(response(overview)).mockResolvedValueOnce(response(saved));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved");
    const options = fetchMock.mock.calls[1]?.[1];
    expect(typeof options?.body).toBe("string");
    const body: unknown = JSON.parse(typeof options?.body === "string" ? options.body : "null");
    expect(body).toMatchObject({
      action: "save_details",
      expectedRevision: 0,
      details: { companyName: "New company", website: "", roleContacts: [] },
    });
    expect(body).toHaveProperty("requestId", expect.stringMatching(/^[a-f\d-]{36}$/));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
  it("retries identical command and UUID after unknown outcome and retains the draft", async () => {
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockRejectedValueOnce(new TypeError("Network disconnected"))
      .mockResolvedValueOnce(response(saved));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/The result is unknown/)).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("New company");
    expect(screen.getByLabelText("Company name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same request" }));
    await screen.findByText("Changes saved");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[2]?.[1]?.body);
  });
  it("preserves a conflict draft and requires review against the reloaded revision", async () => {
    const other = {
      ...overview,
      detailsRevision: 2,
      details: { ...overview.details, website: "https://example.org" },
    };
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: { code: "conflict" } }), { status: 409 }),
      )
      .mockResolvedValueOnce(response(other));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone changed this record");
    expect(screen.getByLabelText("Company name")).toHaveValue("New company");
    fireEvent.click(screen.getByRole("button", { name: "Review and edit draft" }));
    expect(screen.getByLabelText("Company name")).not.toBeDisabled();
    expect(screen.getByLabelText("Company name")).toHaveValue("New company");
    fireEvent.click(screen.getByRole("button", { name: "Reload current data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(screen.getByLabelText("Company name")).toHaveValue("New company");
    expect(screen.getByLabelText("Website")).toHaveValue("https://example.org");
  });
  it("retains known ACK if refreshing the server data fails", async () => {
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockResolvedValueOnce(response(saved))
      .mockRejectedValueOnce(new TypeError("Offline"));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved");
    fireEvent.click(screen.getByRole("button", { name: "Reload current data" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Changes saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("never stores private contact payloads in browser storage", async () => {
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockRejectedValueOnce(new TypeError("Offline"));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/The result is unknown/);
    const stored = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.getItem(sessionStorage.key(i) ?? ""),
    ).join("");
    expect(stored).not.toContain("New company");
    expect(stored).not.toContain("roleContacts");
    expect(stored).toContain("requestId");
  });
  it("safely unlocks a recovered pending operation only after server cancellation", async () => {
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockRejectedValueOnce(new TypeError("Offline"));
    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/The result is unknown/);
    const sent = fetchMock.mock.calls[1]?.[1]?.body;
    const parsed: unknown = JSON.parse(typeof sent === "string" ? sent : "null");
    const command = companyCommandSchema.parse(parsed);
    cleanup();
    fetchMock
      .mockResolvedValueOnce(response(overview))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: { code: "not_found" } }), { status: 404 }),
      )
      .mockResolvedValueOnce(response({ status: "canceled", operationId: command.requestId }));
    render(<CompanyGeneralClient actorId="actor" />);
    expect(await screen.findByLabelText("Company name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same request" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Company name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the pending request" }));
    await waitFor(() => expect(screen.getByLabelText("Company name")).not.toBeDisabled());
    const canceled = fetchMock.mock.calls[4]?.[1]?.body;
    expect(typeof canceled === "string" ? JSON.parse(canceled) : null).toMatchObject({
      action: "cancel_operation",
      operationId: command.requestId,
      operationAction: "save_details",
    });
  });
});
