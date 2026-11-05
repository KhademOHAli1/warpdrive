// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import english from "../messages/workflows.en.json";
import type { PublicationReviewSource } from "./publicationReview";
import { WorkflowPublishReview } from "./WorkflowPublishReview";

function source(): PublicationReviewSource {
  return {
    name: "Reviewable workflow",
    definition: initialBlankDefinition("Manual start"),
    revision: 7,
    dirty: false,
    active: false,
    number: null,
    archivedAt: null,
    available: true,
    capabilities: { edit: true, publish: true },
  };
}
function view(
  current: PublicationReviewSource,
  onConfirm = vi.fn(),
  invalid = false,
  pending = false,
) {
  return (
    <LocaleProvider locale="en">
      <WorkflowPublishReview
        current={current}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        invalid={invalid}
        pending={pending}
      />
    </LocaleProvider>
  );
}
function confirm() {
  return within(screen.getByRole("alertdialog", { name: english.publicationTitle })).getByRole(
    "button",
    { name: english.publicationConfirm },
  );
}
afterEach(cleanup);

describe("publication review content and current-cut fences", () => {
  it("shows named configured steps and initiating-user checks without projecting task payloads", () => {
    const current = source();
    current.definition = initialDefinition({
      start: "Manual record choice",
      read: "Read selected deal",
      task: "Follow-up task",
      subject: "Private authored payload",
    });
    render(view(current));
    const dialog = screen.getByRole("alertdialog", { name: english.publicationTitle });
    for (const name of [
      current.name,
      "Manual record choice",
      "Read selected deal",
      "Follow-up task",
    ])
      expect(within(dialog).getByText(name)).toBeVisible();
    for (const message of [
      english.publicationActivation,
      english.publicationIdentityHint,
      english.publicationStepsHint,
      english.publicationTaskStep,
      english.publicationPermissionsHint,
      english.publicationConnectionsLocal,
      english.publicationSimulationHint,
    ])
      expect(within(dialog).getByText(message)).toBeVisible();
    expect(within(dialog).queryByText("Private authored payload")).not.toBeInTheDocument();
    expect(confirm()).toBeEnabled();
  });

  it("shows unavailable profiles explicitly and does not invent their connection readiness", () => {
    const current = source();
    current.definition = {
      ...current.definition,
      nodes: [
        ...current.definition.nodes,
        {
          id: "notice",
          name: "Future notification",
          type: "notification",
          version: 1,
          config: { title: { kind: "value", value: "Private notice" } },
        },
      ],
    };
    render(view(current));
    expect(screen.getByText(english.publicationUnavailableStep)).toBeVisible();
    expect(screen.getByText(english.publicationConnectionsUnassessed)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(english.notReady);
    expect(confirm()).toBeDisabled();
    expect(screen.queryByText("Private notice")).not.toBeInTheDocument();
  });

  it("requires explicit renewed review after a draft revision changes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const current = source();
    const mounted = render(view(current, onConfirm));
    mounted.rerender(view({ ...current, revision: 8 }, onConfirm));
    expect(confirm()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(english.publicationChanged);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: english.publicationReviewUpdated }));
    expect(confirm()).toBeEnabled();
    await user.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("latches a name change even after the current name returns to the original text", async () => {
    const user = userEvent.setup();
    const current = source();
    const mounted = render(view(current));
    mounted.rerender(view({ ...current, name: "Temporary newer name" }));
    expect(confirm()).toBeDisabled();
    mounted.rerender(view(current));
    expect(confirm()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: english.publicationReviewUpdated }));
    expect(confirm()).toBeEnabled();
  });

  it.each([
    [
      "revoked publish permission",
      (current: PublicationReviewSource): PublicationReviewSource => ({
        ...current,
        capabilities: { ...current.capabilities, publish: false },
      }),
    ],
    [
      "revoked workflow access",
      (current: PublicationReviewSource): PublicationReviewSource => ({
        ...current,
        available: false,
      }),
    ],
    [
      "archived workflow",
      (current: PublicationReviewSource): PublicationReviewSource => ({
        ...current,
        archivedAt: new Date("2026-11-05T00:00:00Z"),
      }),
    ],
    [
      "dirty content without edit permission",
      (current: PublicationReviewSource): PublicationReviewSource => ({
        ...current,
        dirty: true,
        capabilities: { ...current.capabilities, edit: false },
      }),
    ],
  ] as const)("keeps confirmation blocked after reviewing %s", async (_label, change) => {
    const user = userEvent.setup();
    const current = source();
    const onConfirm = vi.fn();
    const mounted = render(view(current, onConfirm));
    mounted.rerender(view(change(current), onConfirm));
    expect(confirm()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: english.publicationReviewUpdated }));
    expect(confirm()).toBeDisabled();
    await user.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps an invalid current cut blocked without treating a renewed review as validation", () => {
    render(view(source(), vi.fn(), true));
    expect(confirm()).toBeDisabled();
  });

  it("does not confirm while another editor operation is pending", () => {
    render(view(source(), vi.fn(), false, true));
    expect(confirm()).toBeDisabled();
  });
});
