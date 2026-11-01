// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { handleHistoryKey } from "./HistoryControls";

afterEach(cleanup);
it("scopes graph shortcuts to the builder and preserves native text undo", () => {
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true };
  render(
    <section aria-label="Builder" onKeyDown={(event) => handleHistoryKey(event, history, true)}>
      <input aria-label="Task title" />
    </section>,
  );
  fireEvent.keyDown(screen.getByRole("region", { name: "Builder" }), { key: "z", metaKey: true });
  fireEvent.keyDown(screen.getByRole("region", { name: "Builder" }), {
    key: "z",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(history.undo).toHaveBeenCalledTimes(1);
  expect(history.redo).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "z", metaKey: true });
  expect(history.undo).toHaveBeenCalledTimes(1);
});
