// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateWorkflowV2 } from "@/features/blocks/validation";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { websiteEnquiryLeadTemplate } from "../websiteEnquiryLeadTemplate";
import { UnifiedWorkflowLibrary } from "./UnifiedWorkflowLibrary";

const actions = vi.hoisted(() => ({
  createWorkflowV2Action: vi.fn(),
  listWorkflowAllEnginesAction: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => actions);
vi.mock("@/features/workflows/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "workflow-csrf" }));

const workflowId = "10000000-0000-4000-8000-000000000001";

function openCreateDialog() {
  render(
    <LocaleProvider>
      <UnifiedWorkflowLibrary canCreate />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New workflow" }));
  return screen.getByRole("combobox", { name: "Template" });
}

function submitDraft(name: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create workflow" }));
}

beforeEach(() => {
  actions.createWorkflowV2Action.mockResolvedValue({ ok: true, value: { id: workflowId } });
  actions.listWorkflowAllEnginesAction.mockResolvedValue({
    ok: true,
    value: { rows: [], nextCursor: null, total: 0 },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("workflow library draft templates", () => {
  it("keeps blank workflow creation as the default", async () => {
    expect(openCreateDialog()).toHaveTextContent("Blank workflow");
    submitDraft("Manual follow-up");

    expect(actions.createWorkflowV2Action).toHaveBeenCalledExactlyOnceWith(
      { name: "Manual follow-up" },
      "workflow-csrf",
    );
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith(`/workflows/${workflowId}`));
  });

  it("submits the authenticated website enquiry workflow for draft creation", async () => {
    fireEvent.click(openCreateDialog());
    fireEvent.click(screen.getByRole("option", { name: "Website enquiry to lead" }));
    submitDraft("Website enquiries");

    expect(validateWorkflowV2(websiteEnquiryLeadTemplate).ok).toBe(true);
    expect(actions.createWorkflowV2Action).toHaveBeenCalledExactlyOnceWith(
      { name: "Website enquiries", definition: websiteEnquiryLeadTemplate },
      "workflow-csrf",
    );
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith(`/workflows/${workflowId}`));
  });
});
