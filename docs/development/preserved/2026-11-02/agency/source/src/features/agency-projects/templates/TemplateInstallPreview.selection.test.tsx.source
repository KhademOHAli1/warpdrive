// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  contextKey,
  personLabel,
  previewPacket,
  previewView,
  staffLabel,
} from "./TemplateInstallPreview.test-support";
import type { TemplatePreviewTarget } from "./templateInstallPreviewTypes";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
afterEach(cleanup);

function expectPrivatePreviewHidden() {
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  for (const privateText of [
    "Model production",
    staffLabel,
    personLabel,
    "Not mapped",
    "User unavailable",
    "Contact unavailable",
  ]) {
    expect(document.body).not.toHaveTextContent(privateText);
  }
  expect(screen.getByRole("alert")).toHaveTextContent("Template preview is unavailable.");
  expect(screen.getByRole("alert")).toHaveClass("ph-block-email", "ph-no-capture");
  expect(document.querySelector("time")).toBeNull();
}

it("hides all private content and fallback labels without current read authority", () => {
  render(previewView(previewPacket(), undefined, { canRead: false }));
  expectPrivatePreviewHidden();
});

it("removes visible contents on read loss and keeps them absent without replacement data or after teardown", () => {
  const packet = previewPacket();
  const view = render(previewView(packet));
  expect(screen.getByText(staffLabel)).toBeInTheDocument();
  view.rerender(previewView(packet, undefined, { canRead: false }));
  expectPrivatePreviewHidden();
  view.rerender(previewView(packet, undefined, { data: null }));
  expectPrivatePreviewHidden();
  view.unmount();
  expect(document.body).not.toHaveTextContent(staffLabel);
});

it("hides an older context-bound packet after the session or workspace context changes", () => {
  const packet = previewPacket();
  const view = render(previewView(packet));
  view.rerender(previewView(packet, undefined, { contextKey: `${contextKey}:replacement` }));
  expectPrivatePreviewHidden();
});

const changedTargets: { name: string; change: Partial<TemplatePreviewTarget> }[] = [
  { name: "project", change: { projectId: "11111111-1111-4111-8111-111111111111" } },
  { name: "template", change: { templateId: "other_template" } },
  { name: "version", change: { version: 2 } },
  { name: "draft selection", change: { selectionKey: "draft-selection:2" } },
];

it.each(changedTargets)(
  "hides a stale $name instead of independently joining old projections",
  ({ change }) => {
    const packet = previewPacket();
    const view = render(previewView(packet));
    view.rerender(previewView(packet, undefined, { target: { ...packet.target, ...change } }));
    expectPrivatePreviewHidden();
  },
);

it.each([
  { name: "template identity", change: { templateId: "other_template" } },
  { name: "template version", change: { version: 2 } },
])("requires the trusted manifest's $name to match the selected target", ({ change }) => {
  const packet = previewPacket();
  render(previewView({ ...packet, manifest: { ...packet.manifest, ...change } }));
  expectPrivatePreviewHidden();
});

it.each([
  { name: "empty context", currentContext: "", selectionKey: "selected" },
  { name: "blank context", currentContext: "   ", selectionKey: "selected" },
  { name: "empty selection key", currentContext: contextKey, selectionKey: "" },
  { name: "blank selection key", currentContext: contextKey, selectionKey: "   " },
])("requires a usable selection context: $name", ({ currentContext, selectionKey }) => {
  const packet = previewPacket();
  const target = { ...packet.target, selectionKey };
  render(
    previewView({ ...packet, target, contextKey: currentContext }, undefined, {
      contextKey: currentContext,
      target,
    }),
  );
  expectPrivatePreviewHidden();
});

it("hides private data when no current target is selected", () => {
  render(previewView(previewPacket(), undefined, { target: null }));
  expectPrivatePreviewHidden();
});

it.each(["", "   "])(
  "hides private data for a matching blank selected project (%j)",
  (projectId) => {
    const packet = previewPacket();
    const target = { ...packet.target, projectId };
    render(previewView({ ...packet, target }, undefined, { target }));
    expectPrivatePreviewHidden();
  },
);
