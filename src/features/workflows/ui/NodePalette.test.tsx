// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { PickerSelection } from "../paletteContext";
import { NodePalette } from "./NodePalette";
import { paletteDefinition, readyPaletteRead } from "./palette.TestHelpers";
import { buildPaletteView } from "./paletteView";

afterEach(cleanup);
it("offers localized action groups in the inline panel and excludes trigger choices", () => {
  const onChoose = vi.fn<(selection: PickerSelection) => void>();
  const model = buildPaletteView(
    paletteDefinition(),
    { kind: "detached" },
    readyPaletteRead(),
    true,
  );
  render(
    <LocaleProvider locale="de">
      <NodePalette open onClose={vi.fn()} model={model} onChoose={onChoose} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("dialog").textContent).toContain("Aktion auswählen");
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "Aktion auswählen",
    "Daten",
    "Ablauf",
    "Kern",
  ]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /Manueller/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Aufgabe erstellen" }));
  expect(onChoose).toHaveBeenCalledWith({ kind: "insert", type: "activity.create", version: 1 });
});
it("keeps unavailable actions disabled and does not grant authoring in read-only mode", () => {
  const onChoose = vi.fn();
  const model = buildPaletteView(
    paletteDefinition(),
    { kind: "detached" },
    readyPaletteRead(),
    false,
  );
  render(
    <LocaleProvider locale="en">
      <NodePalette open onClose={vi.fn()} model={model} onChoose={onChoose} />
    </LocaleProvider>,
  );
  for (const button of screen
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-disabled") === "true"))
    fireEvent.click(button);
  expect(onChoose).not.toHaveBeenCalled();
});
it("separates trigger replacement from action insertion and preserves dismissal", () => {
  const onClose = vi.fn();
  const model = buildPaletteView(
    paletteDefinition(),
    { kind: "replace", nodeId: "start" },
    readyPaletteRead(),
    true,
  );
  render(
    <LocaleProvider locale="en">
      <NodePalette open onClose={onClose} model={model} onChoose={vi.fn()} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("heading", { name: "Select Trigger" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
