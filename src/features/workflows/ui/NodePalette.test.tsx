// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { PickerSelection } from "../paletteContext";
import { NodePalette } from "./NodePalette";
import { paletteDefinition, readyPaletteRead } from "./palette.TestHelpers";
import { buildPaletteView } from "./paletteView";

afterEach(cleanup);
it("searches localized actions, explains the source branch and offers an empty-result recovery", () => {
  const onChoose = vi.fn<(selection: PickerSelection) => void>();
  const definition = paletteDefinition();
  definition.nodes.push({
    id: "review",
    type: "condition",
    version: 1,
    name: "Prüfung",
    nameMode: "custom",
    config: {
      left: { kind: "reference", nodeId: "start", path: ["recordId"] },
      operator: "exists",
    },
  });
  definition.edges.push({ from: "start", to: "review", port: "next" });
  const model = buildPaletteView(
    definition,
    { kind: "output", output: { from: "review", port: "true" } },
    readyPaletteRead(),
    true,
  );
  render(
    <LocaleProvider locale="de">
      <NodePalette open onClose={vi.fn()} model={model} onChoose={onChoose} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Prüfung · Trifft zu")).toBeDefined();
  const search = screen.getByRole("textbox", { name: "Schritte suchen" });
  fireEvent.change(search, { target: { value: "Aufgabe" } });
  expect(screen.queryByRole("button", { name: /Bedingung/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Aufgabe erstellen/ }));
  expect(onChoose).toHaveBeenCalledWith({ kind: "insert", type: "activity.create", version: 1 });
  fireEvent.change(search, { target: { value: "does not exist" } });
  expect(screen.getByText("Keine passenden Schritte")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
  expect(screen.getByRole("button", { name: /Bedingung/ })).toBeDefined();
});
