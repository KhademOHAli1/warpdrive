// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MockActionResult } from "@/test/actionResult";

const { createTemplate, createSignature, report } = vi.hoisted(() => ({
  createTemplate: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(),
  createSignature: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(),
  report: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({ html }: { html: string }) => <div>{html}</div>,
}));
vi.mock("@/features/email/authoringActions", () => ({
  createTemplateAction: createTemplate,
  createSignatureAction: createSignature,
  updateTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  deleteTemplatesAction: vi.fn(),
  reorderTemplatesAction: vi.fn(),
  updateSignatureAction: vi.fn(),
  deleteSignatureAction: vi.fn(),
  setDefaultSignatureAction: vi.fn(),
}));

import { SignaturesSettingsClient } from "./SignaturesSettingsClient";
import { TemplatesSettingsClient } from "./TemplatesSettingsClient";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each([
  ["template", "result"],
  ["template", "transport"],
  ["signature", "result"],
  ["signature", "transport"],
])(
  "preserves the %s draft after %s failure and locks duplicate or cancelling saves",
  async (kind, failure) => {
    let finish: (value: MockActionResult<{ id: string }>) => void = () => {};
    let reject: (reason: TypeError) => void = () => {};
    const action = kind === "template" ? createTemplate : createSignature;
    const request = new Promise<MockActionResult<{ id: string }>>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    action.mockImplementation(() => request);
    render(
      kind === "template" ? (
        <TemplatesSettingsClient templates={[]} canShare />
      ) : (
        <SignaturesSettingsClient signatures={[]} />
      ),
    );
    const newLabel = kind === "template" ? "New template" : "New signature";
    const flag = kind === "template" ? "Share with team" : "Set as default";
    fireEvent.click(screen.getByRole("button", { name: newLabel }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("checkbox", { name: flag }));
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByText("Saving...")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: newLabel })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    if (failure === "result") finish({ ok: false, error: { id: "E_PERM_001" } });
    else reject(new TypeError("connection lost"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByLabelText("Name")).toHaveValue("Keep this draft");
    expect(screen.getByRole("checkbox", { name: flag })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  },
);
