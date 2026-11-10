// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import {
  ControlledCreationView,
  creationProps,
  creationView,
  intentId,
  otherOwnerId,
  ownerId,
  renderCreation,
} from "./ProjectCreationForm.test-support";

afterEach(cleanup);

function submitForm() {
  fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
}

describe("project creation fields", () => {
  it.each([
    ["en", "Create project", "Project name", "Internal owner"],
    ["de", "Projekt anlegen", "Projektname", "Intern verantwortlich"],
    ["fa", "ایجاد پروژه", "نام پروژه", "مسئول داخلی"],
  ] as const)("renders accessible %s labels", (locale, form, title, owner) => {
    renderCreation(creationProps(), locale);
    expect(screen.getByRole("form", { name: form })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: owner })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: form })).toHaveAttribute("type", "submit");
  });

  it("gives two mounted forms distinct label IDs", () => {
    renderCreation();
    renderCreation();
    const fields = screen.getAllByRole("textbox", { name: "Project name" });
    expect(new Set(fields.map((field) => field.id)).size).toBe(2);
    expect(fields.every((field) => field.id.length > 0)).toBe(true);
  });

  it("preserves the intent and CRM anchors when editing the title", () => {
    const props = creationProps();
    renderCreation(props);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New title" } });
    expect(props.onDraftChange).toHaveBeenCalledWith({
      ...props.draft,
      input: { ...props.draft.input, title: "New title" },
    });
  });

  it("protects the full private form and the opened portalled owner list", async () => {
    const props = creationProps();
    renderCreation(props);
    const form = screen.getByRole("form");
    expect(form).toHaveClass("ph-block-email", "ph-no-capture");
    const picker = screen.getByRole("combobox");
    expect(picker).toHaveClass("ph-block-email", "ph-no-capture");
    await userEvent.setup().click(picker);
    const list = screen.getByRole("listbox");
    expect(form.contains(list)).toBe(false);
    expect(list).toHaveClass("ph-block-email", "ph-no-capture");
    await userEvent.setup().click(screen.getByRole("option", { name: "Alex Müller" }));
    expect(props.onDraftChange).toHaveBeenCalledWith({
      ...props.draft,
      input: { ...props.draft.input, ownerUserId: otherOwnerId },
    });
    expect(screen.queryByText(ownerId)).not.toBeInTheDocument();
  });

  it.each(["", "  ", "x".repeat(161), "\u0000", "\u200b", "😀".repeat(161)])(
    "rejects an invalid title before calling the service (%s)",
    (title) => {
      const props = creationProps();
      props.draft.input.title = title;
      renderCreation(props);
      submitForm();
      expect(props.submit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
      const description = screen.getByRole("textbox").getAttribute("aria-describedby");
      expect(description).toBeTruthy();
      expect(document.getElementById(description ?? "")).toHaveAttribute("role", "alert");
    },
  );

  it("accepts 160 emoji codepoints and sends the normalized six-key boundary payload", () => {
    const props = creationProps();
    props.draft.input.title = `  ${"😀".repeat(160)}  `;
    props.draft.input.ownerUserId = ownerId.toUpperCase();
    renderCreation(props);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "320");
    submitForm();
    expect(props.submit).toHaveBeenCalledWith(
      { ...props.draft.input, title: "😀".repeat(160), ownerUserId: ownerId, intentId },
      expect.any(AbortSignal),
    );
  });

  it.each(["owner", "anchors"])("rejects invalid %s before service invocation", (kind) => {
    const props = creationProps();
    if (kind === "owner") props.draft.input.ownerUserId = otherOwnerId;
    else props.draft.input.dealId = null;
    props.owners = [{ id: ownerId, label: "Sara رضایی" }];
    renderCreation(props);
    submitForm();
    expect(props.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it.each(["permission", "context", "mismatch", "blank-label", "no-owners"])(
    "fails closed for unavailable %s without private labels",
    (kind) => {
      const props = creationProps();
      if (kind === "permission") props.canCreate = false;
      if (kind === "context") props.contextLabel = null;
      if (kind === "mismatch") props.contextKey = "new-actor-context";
      if (kind === "blank-label") props.owners = [{ id: ownerId, label: " " }];
      if (kind === "no-owners") props.owners = [];
      renderCreation(props);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByText("Private CRM context")).not.toBeInTheDocument();
      expect(screen.queryByText("Sara رضایی")).not.toBeInTheDocument();
      expect(props.submit).not.toHaveBeenCalled();
    },
  );

  it("retains the controlled draft and intent across a locale change", () => {
    const props = creationProps();
    const view = renderCreation(props);
    view.rerender(creationView(props, "fa"));
    expect(screen.getByRole("textbox", { name: "نام پروژه" })).toHaveValue(props.draft.input.title);
    expect(props.onDraftChange).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form"));
    expect(props.submit).toHaveBeenCalledWith(
      expect.objectContaining({ intentId }),
      expect.any(AbortSignal),
    );
  });

  it("preserves actual title and owner edits across locale changes", async () => {
    const props = creationProps();
    const view = render(<ControlledCreationView {...props} locale="en" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited draft / ویرایش" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Alex Müller" }));
    view.rerender(<ControlledCreationView {...props} locale="fa" />);
    expect(screen.getByRole("textbox", { name: "نام پروژه" })).toHaveValue("Edited draft / ویرایش");
    fireEvent.submit(screen.getByRole("form"));
    expect(props.submit).toHaveBeenCalledWith(
      { ...props.draft.input, title: "Edited draft / ویرایش", ownerUserId: otherOwnerId },
      expect.any(AbortSignal),
    );
  });

  it("rejects a stale owner after the eligible projection changes", () => {
    const props = creationProps();
    const view = renderCreation(props);
    view.rerender(creationView({ ...props, owners: [{ id: otherOwnerId, label: "Alex Müller" }] }));
    submitForm();
    expect(props.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Sara رضایی")).not.toBeInTheDocument();
    expect(screen.queryByText(ownerId)).not.toBeInTheDocument();
  });

  it("removes an open private portal immediately when permission disappears", async () => {
    const props = creationProps();
    const view = renderCreation(props);
    await userEvent.setup().click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    view.rerender(creationView({ ...props, canCreate: false }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Sara رضایی")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex Müller")).not.toBeInTheDocument();
  });
});
