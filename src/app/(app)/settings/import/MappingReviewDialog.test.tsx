// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialWizardState } from "@/features/import/wizardState";
import { MappingReviewDialog } from "./MappingReviewDialog";
import { enableMappingReviewPopover } from "./mappingReviewTestDom";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/features/observability/capture", () => ({
  capture,
  currentRoute: () => "/settings/import",
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

let restorePopover: () => void;
beforeEach(() => {
  restorePopover = enableMappingReviewPopover();
});
afterEach(() => {
  cleanup();
  restorePopover();
  capture.mockClear();
});

const state = {
  ...initialWizardState(),
  step: "preview" as const,
  headers: ["Company"],
  rows: [{ Company: "Sample company" }],
};

function Review({
  busy = false,
  onStartOver = () => undefined,
}: {
  busy?: boolean;
  onStartOver?: () => void;
}) {
  return (
    <MappingReviewDialog
      state={state}
      defs={[]}
      hiddenBuiltins={{}}
      busy={busy}
      onStartOver={onStartOver}
    />
  );
}

function Wizard({ onReset }: { onReset: () => void }) {
  const [preview, setPreview] = useState(true);
  return preview ? (
    <Review
      onStartOver={() => {
        onReset();
        setPreview(false);
      }}
    />
  ) : (
    <p>Upload</p>
  );
}

describe("MappingReviewDialog", () => {
  it.each([
    ["en", "Review mapping", "Close", "Import another file", "ltr"],
    ["de", "Zuordnung prüfen", "Schließen", "Weitere Datei importieren", "ltr"],
    ["fa", "بررسی نگاشت", "بستن", "ورود فایل دیگر", "rtl"],
  ] as const)(
    "retains localized controls and mapping content in %s",
    async (locale, title, close, reset, dir) => {
      const user = userEvent.setup();
      render(
        <LocaleProvider locale={locale}>
          <Review />
        </LocaleProvider>,
      );
      const trigger = screen.getByRole("button", { name: title });
      await user.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: title });
      expect(dialog).toHaveAttribute("dir", dir);
      expect(dialog).toHaveAccessibleDescription();
      expect(within(dialog).getByText("Sample company")).toBeInTheDocument();
      const closeButton = within(dialog).getByRole("button", { name: close });
      expect(closeButton).toHaveAttribute("tabindex", "0");
      expect(within(dialog).getByRole("button", { name: reset })).toHaveAttribute("tabindex", "0");
      await user.click(closeButton);
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(capture.mock.calls).toEqual([
        ["modal_opened", { route: "/settings/import" }],
        ["modal_closed", { route: "/settings/import", reason: "user" }],
      ]);
    },
  );

  it("disables opening and Start over while busy, but allows an open review to close", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Review busy />);
    const trigger = screen.getByRole("button", { name: "Review mapping" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();

    rerender(<Review />);
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Review mapping" });
    await waitFor(() => expect(dialog).toHaveFocus());
    rerender(<Review busy />);
    expect(within(dialog).getByRole("button", { name: "Import another file" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(capture.mock.calls).toEqual([
      ["modal_opened", { route: "/settings/import" }],
      ["modal_closed", { route: "/settings/import", reason: "escape" }],
    ]);
  });

  it("records Start over once before the wizard removes the review", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <StrictMode>
        <Wizard onReset={reset} />
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "Review mapping" }));
    const dialog = await screen.findByRole("dialog", { name: "Review mapping" });
    await user.click(within(dialog).getByRole("button", { name: "Import another file" }));
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls).toEqual([
      ["modal_opened", { route: "/settings/import" }],
      ["modal_closed", { route: "/settings/import", reason: "user" }],
    ]);
  });
});
