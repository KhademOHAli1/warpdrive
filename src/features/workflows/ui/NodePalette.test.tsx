// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NodePalette } from "./NodePalette";

afterEach(cleanup);
it("searches localized actions, explains the source branch and offers an empty-result recovery", () => {
  const onAdd = vi.fn();
  render(
    <LocaleProvider locale="de">
      <NodePalette open onClose={vi.fn()} onAdd={onAdd} context="Prüfung · Trifft zu" />
    </LocaleProvider>,
  );
  expect(screen.getByText("Prüfung · Trifft zu")).toBeDefined();
  const search = screen.getByRole("textbox", { name: "Schritte suchen" });
  fireEvent.change(search, { target: { value: "Aufgabe" } });
  expect(screen.queryByRole("button", { name: /Bedingung/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Aufgabe erstellen/ }));
  expect(onAdd).toHaveBeenCalledWith("activity.create");
  fireEvent.change(search, { target: { value: "does not exist" } });
  expect(screen.getByText("Keine passenden Schritte")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Suche zurücksetzen" }));
  expect(screen.getByRole("button", { name: /Bedingung/ })).toBeDefined();
});
