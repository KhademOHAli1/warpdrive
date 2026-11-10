// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "./NativeSubjectReviewCardTestKit";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ok } from "@/types/result";
import { NativeSubjectReviewCard } from "./NativeSubjectReviewCard";
import { cardProps, labels, mocks, reset, source, wrap } from "./NativeSubjectReviewCardTestKit";

beforeEach(reset);
afterEach(cleanup);
async function load() {
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(labels.en.notice, {}, { timeout: 1000 });
}

test("a one-million-character value has bounded DOM and an explicit route to its final segment", async () => {
  const row = source("user");
  const tail = "FINAL-SOURCE-SEGMENT";
  row.record.values.name = "x".repeat(1000000 - tail.length) + tail;
  mocks.load.mockResolvedValueOnce(ok(row));
  const view = render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  await load();
  const field = screen.getByRole("group", { name: labels.en.name });
  expect(field.textContent?.length ?? 0).toBeLessThan(10000);
  expect(view.container.textContent?.length ?? 0).toBeLessThan(30000);
  expect(field.textContent).not.toContain(tail);
  fireEvent.click(within(field).getByRole("button", { name: labels.en.lastText }));
  expect(field.textContent).toContain(tail);
  expect(field.textContent?.length ?? 0).toBeLessThan(10000);
});

test("text segments expose every value in order and preserve Unicode at segment edges", async () => {
  const row = source("user");
  const value = `BEGIN-${"🚀".repeat(6000)}-END`;
  row.record.values.name = value;
  mocks.load.mockResolvedValueOnce(ok(row));
  render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  await load();
  const field = screen.getByRole("group", { name: labels.en.name });
  let observed = "";
  let pages = 0;
  for (;;) {
    const segment =
      within(field).getByRole("document", { name: labels.en.segment }).textContent ?? "";
    expect(segment.length).toBeLessThan(10000);
    expect(segment).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    observed += segment;
    const next = within(field).getByRole("button", { name: labels.en.nextText });
    pages += 1;
    if (next.hasAttribute("disabled")) break;
    assert(pages < 30, "text paging did not terminate within the bounded fixture");
    fireEvent.click(next);
  }
  expect(pages).toBeGreaterThan(1);
  expect(observed).toBe(value);
  fireEvent.click(within(field).getByRole("button", { name: labels.en.previousText }));
  expect(within(field).getByRole("button", { name: labels.en.nextText })).toBeEnabled();
});

test("contact-point paging keeps at most twenty rows and makes every point reachable", async () => {
  const row = source();
  assert(row.record.store === "persons");
  const expected = Array.from({ length: 37 }, (_, index) => ({
    label: `Point ${index + 1}`,
    value: `point-${index + 1}@example.test`,
  }));
  row.record.values.emails = expected;
  mocks.load.mockResolvedValueOnce(ok(row));
  render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  await load();
  const field = screen.getByRole("group", { name: labels.en.emails });
  const observed: string[] = [];
  let pages = 0;
  for (;;) {
    const visible = expected.filter((point) => within(field).queryByText(point.value) !== null);
    expect(visible.length).toBeLessThanOrEqual(20);
    expect(visible.length).toBeGreaterThan(0);
    observed.push(...visible.map((point) => point.value));
    const next = within(field).getByRole("button", { name: labels.en.nextPoints });
    pages += 1;
    if (next.hasAttribute("disabled")) break;
    assert(pages < 10, "contact paging did not terminate within the bounded fixture");
    fireEvent.click(next);
  }
  expect(observed).toEqual(expected.map((point) => point.value));
  fireEvent.click(within(field).getByRole("button", { name: labels.en.previousPoints }));
  expect(within(field).getByText(expected[0]?.value ?? "")).toBeInTheDocument();
});

for (const asciiUnits of [3999, 7999] as const)
  test(`text paging preserves a trailing surrogate pair after ${asciiUnits} ASCII units without an empty page`, async () => {
    const row = source("user");
    const value = `${"x".repeat(asciiUnits)}🚀`;
    row.record.values.name = value;
    mocks.load.mockResolvedValueOnce(ok(row));
    render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
    await load();
    const field = screen.getByRole("group", { name: labels.en.name });
    const observed: string[] = [];
    for (;;) {
      const segment =
        within(field).getByRole("document", {
          name: labels.en.segment,
        }).textContent ?? "";
      expect(segment).not.toBe("");
      expect(segment).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      observed.push(segment);
      const next = within(field).queryByRole("button", { name: labels.en.nextText });
      if (next === null || next.hasAttribute("disabled")) break;
      assert(
        observed.length < 10,
        "trailing-pair paging did not terminate within the bounded fixture",
      );
      fireEvent.click(next);
    }
    expect(observed.join("")).toBe(value);
    expect(observed[observed.length - 1]?.endsWith("🚀")).toBe(true);
  });
