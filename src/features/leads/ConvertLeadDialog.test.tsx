// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";
import { ConvertLeadDialog } from "./ConvertLeadDialog";

afterEach(cleanup);

const grade: CustomFieldDef = {
  id: "cf-grade",
  targetEntity: "deal",
  type: "text",
  name: "Grade",
  key: "grade",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: true,
  order: 0,
  archivedAt: null,
};

it("opens prefilled with initialValues and submits them merged with edits", async () => {
  const onConvert = vi.fn(() => Promise.resolve(true));
  render(
    <ConvertLeadDialog
      defs={[grade]}
      initialValues={{ grade: "A" }}
      onClose={() => {}}
      onConvert={onConvert}
    />,
  );
  expect(screen.getByLabelText("Grade")).toHaveValue("A");
  fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onConvert).toHaveBeenCalledWith({ grade: "B" }));
});

it("leaves a carried value it never rendered out of the payload", async () => {
  const onConvert = vi.fn(() => Promise.resolve(true));
  render(
    <ConvertLeadDialog
      defs={[
        grade,
        { ...grade, id: "cf-hidden", key: "hidden", name: "Hidden", showInAddForm: false },
      ]}
      initialValues={{ grade: "A", hidden: "keep" }}
      onClose={() => {}}
      onConvert={onConvert}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onConvert).toHaveBeenCalledWith({ grade: "A" }));
});

it("submits an explicit null when a prefilled value is cleared", async () => {
  const onConvert = vi.fn(() => Promise.resolve(true));
  render(
    <ConvertLeadDialog
      defs={[grade]}
      initialValues={{ grade: "A" }}
      onClose={() => {}}
      onConvert={onConvert}
    />,
  );
  fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onConvert).toHaveBeenCalledWith({ grade: null }));
});

it("does not convert with a stale custom-field time while an invalid raw time is shown", () => {
  const onConvert = vi.fn(() => Promise.resolve(true));
  const onClose = vi.fn();
  render(
    <ConvertLeadDialog
      defs={[{ ...grade, type: "time", name: "Due time", key: "time" }]}
      initialValues={{ time: "09:00" }}
      onClose={onClose}
      onConvert={onConvert}
    />,
  );
  const input = screen.getByLabelText("Due time");
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onConvert).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("checks both endpoints before submitting custom time-range fields", () => {
  const onConvert = vi.fn(() => Promise.resolve(true));
  render(
    <ConvertLeadDialog
      defs={[{ ...grade, type: "time_range", name: "Window", key: "window" }]}
      initialValues={{ window: { start: "09:00", end: "10:00" } }}
      onClose={vi.fn()}
      onConvert={onConvert}
    />,
  );
  const input = screen.getByLabelText("Window: end");
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onConvert).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid time");
  fireEvent.change(input, { target: { value: "11:00" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onConvert).toHaveBeenCalledWith({ window: { start: "09:00", end: "11:00" } });
});
