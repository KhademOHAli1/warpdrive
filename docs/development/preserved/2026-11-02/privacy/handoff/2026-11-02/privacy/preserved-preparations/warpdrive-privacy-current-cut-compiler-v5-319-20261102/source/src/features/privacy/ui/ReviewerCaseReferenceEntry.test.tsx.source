// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "../__fixtures__/ReviewerCaseReferenceEntryTestKit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  CASE,
  CHILD_PRIVATE,
  entryProps,
  labels,
  mocks,
  NEXT_CASE,
  reset,
  wrap,
} from "../__fixtures__/ReviewerCaseReferenceEntryTestKit";
import { ReviewerCaseReferenceEntry } from "./ReviewerCaseReferenceEntry";

beforeEach(reset);
afterEach(cleanup);

for (const locale of ["en", "de", "fa"] as const) {
  test(`${locale} initial exact-case entry is localized and opens no source child`, () => {
    const props = entryProps();
    render(wrap(<ReviewerCaseReferenceEntry {...props} />, locale));
    expect(screen.getByRole("heading", { name: labels[locale].title })).toBeInTheDocument();
    expect(screen.getByLabelText(labels[locale].reference)).toHaveValue("");
    expect(screen.getByRole("button", { name: labels[locale].open })).toBeInTheDocument();
    expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
    expect(mocks.child).not.toHaveBeenCalled();
    expect(props.refreshSecurity).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  for (const submit of ["Enter", "Button"] as const)
    test(`${locale} ${submit} opens only the exact opaque case and forwards native child context`, async () => {
      const props = entryProps();
      const user = userEvent.setup();
      render(wrap(<ReviewerCaseReferenceEntry {...props} />, locale));
      await user.type(screen.getByLabelText(labels[locale].reference), CASE);
      if (submit === "Enter") await user.keyboard("{Enter}");
      else await user.click(screen.getByRole("button", { name: labels[locale].open }));
      expect(screen.getByTestId("exact-case-preview")).toBeInTheDocument();
      const child = mocks.child.mock.calls.at(-1)?.[0];
      expect(child).toEqual({
        caseId: CASE,
        securityStatus: props.securityStatus,
        refreshSecurity: props.refreshSecurity,
        securityUnavailable: false,
      });
      expect(child?.refreshSecurity).toBe(props.refreshSecurity);
      expect(props.refreshSecurity).not.toHaveBeenCalled();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /export|approve|generate/iu }),
      ).not.toBeInTheDocument();
    });
}

test.each([
  "",
  "not-a-uuid",
  CASE.replaceAll("-", ""),
  "https://private.example.test/case",
  JSON.stringify({ caseId: CASE }),
])("invalid or empty exact-case input %j stays inline without a child", (value) => {
  render(wrap(<ReviewerCaseReferenceEntry {...entryProps()} />));
  fireEvent.change(screen.getByLabelText(labels.en.reference), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: labels.en.open }));
  expect(screen.getByRole("alert")).toHaveTextContent(labels.en.invalid);
  expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
  expect(mocks.child).not.toHaveBeenCalled();
});

test("editing a case reference immediately removes its old source child before another submission", () => {
  const props = entryProps();
  render(wrap(<ReviewerCaseReferenceEntry {...props} />));
  const input = screen.getByLabelText(labels.en.reference);
  fireEvent.change(input, { target: { value: CASE } });
  fireEvent.click(screen.getByRole("button", { name: labels.en.open }));
  expect(screen.getByText(CHILD_PRIVATE)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: NEXT_CASE } });
  expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
  expect(screen.queryByText(CHILD_PRIVATE)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: labels.en.open }));
  expect(mocks.child.mock.calls.at(-1)?.[0]?.caseId).toBe(NEXT_CASE);
  expect(props.refreshSecurity).not.toHaveBeenCalled();
});

test("pasted surrounding whitespace and uppercase UUID hex pass only canonical lower-case caseId", () => {
  render(wrap(<ReviewerCaseReferenceEntry {...entryProps()} />));
  fireEvent.change(screen.getByLabelText(labels.en.reference), {
    target: {
      value: `  ${CASE.toUpperCase()} 
`,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: labels.en.open }));
  expect(mocks.child.mock.calls.at(-1)?.[0]?.caseId).toBe(CASE);
  expect(screen.getByTestId("exact-case-preview")).toBeInTheDocument();
});

test("the opaque-reference input is replay-blocked with a stable nonprivate label association", () => {
  const props = entryProps();
  const view = render(wrap(<ReviewerCaseReferenceEntry {...props} />));
  const input = screen.getByLabelText(labels.en.reference);
  const label = screen.getByText(labels.en.reference);
  expect(label.tagName).toBe("LABEL");
  expect(input.id).not.toBe("");
  expect(label).toHaveAttribute("for", input.id);
  const id = input.id;
  fireEvent.change(input, { target: { value: CASE } });
  expect(input.id).not.toContain(CASE);
  const boundary = input.closest(`.${BLOCK_CLASS}`);
  expect(boundary).not.toBeNull();
  expect(boundary).toHaveClass("ph-no-capture");
  view.rerender(wrap(<ReviewerCaseReferenceEntry {...props} securityUnavailable />));
  expect(screen.getByLabelText(labels.en.reference)).toHaveAttribute("id", id);
  for (const node of view.container.querySelectorAll("*"))
    for (const attribute of node.attributes) {
      expect(attribute.value).not.toContain(CHILD_PRIVATE);
    }
});
