// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

const { reportError, invalidateStatus, refresh } = vi.hoisted(() => ({
  reportError: vi.fn(),
  invalidateStatus: vi.fn(() => Promise.resolve()),
  refresh: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: { useUtils: () => ({ enrichment: { status: { invalidate: invalidateStatus } } }) },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => reportError }));
vi.mock("@/features/enrichment/settingsActions", () => ({
  setProviderKeyAction: vi.fn(() => Promise.resolve({ ok: true })),
  clearProviderKeyAction: vi.fn(),
  setProviderEnabledAction: vi.fn(),
  setMappingAction: vi.fn(),
  clearMappingAction: vi.fn(),
  setCacheTtlAction: vi.fn(),
  testProviderAction: vi.fn(),
}));

import { setProviderKeyAction, testProviderAction } from "@/features/enrichment/settingsActions";
import { EnrichmentClient } from "./EnrichmentClient";

const S = settingsMessagesForLocale("en")._enrichment.settings;

function setup() {
  render(
    <EnrichmentClient
      providers={[
        {
          provider: "apollo",
          name: "Apollo",
          enabled: false,
          hasKey: false,
          apiKeyHint: null,
          throttledUntilIso: null,
          throttleReason: null,
          needsAttention: false,
        },
      ]}
      person={{ entity: "person", title: S.mappingPerson, rows: [], hasCustomFields: false }}
      organization={{
        entity: "organization",
        title: S.mappingOrganization,
        rows: [],
        hasCustomFields: false,
      }}
      cacheTtlDays={30}
    />,
  );
  const field = screen.getByLabelText(S.apiKeyLabel);
  fireEvent.change(field, { target: { value: "replacement-key" } });
  fireEvent.click(screen.getByRole("button", { name: S.save }));
  return field;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("EnrichmentClient key save outcome", () => {
  it("keeps a rejected action draft ready for retry and clears it after the server confirms", async () => {
    vi.mocked(setProviderKeyAction).mockResolvedValueOnce({
      ok: false,
      error: { id: "E_ENRICH_010" },
    });
    const field = setup();
    await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_ENRICH_010"));
    expect(field).toHaveValue("replacement-key");
    expect(await screen.findByRole("alert")).toHaveTextContent("Try saving again.");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(setProviderKeyAction).toHaveBeenCalledTimes(2);
    expect(testProviderAction).not.toHaveBeenCalled();
  });

  it("clears an acknowledged save even if the status query refresh fails", async () => {
    invalidateStatus.mockRejectedValueOnce(new Error("cache unavailable"));
    const field = setup();
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: S.save })).toBeEnabled());
    expect(field).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
