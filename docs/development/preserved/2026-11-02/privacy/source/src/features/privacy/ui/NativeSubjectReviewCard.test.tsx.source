// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "./NativeSubjectReviewCardTestKit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { err, ok } from "@/types/result";
import { NativeSubjectReviewCard } from "./NativeSubjectReviewCard";
import {
  CASE,
  CREATED,
  cardProps,
  dateLabel,
  deferred,
  EMAIL,
  labels,
  mocks,
  NAME,
  NEXT_CASE,
  REVIEWER,
  reset,
  SUBJECT,
  source,
  UPDATED,
  wrap,
} from "./NativeSubjectReviewCardTestKit";

beforeEach(reset);
afterEach(cleanup);
async function load(locale: Locale = "en") {
  fireEvent.click(screen.getByRole("button", { name: labels[locale].load }));
  await screen.findByText(labels[locale].notice, {}, { timeout: 1000 });
}

for (const locale of ["en", "de", "fa"] as const)
  for (const kind of ["person", "user"] as const)
    test(`${locale} ${kind}: explicit native recheck precedes deny-only load and localized preliminary fields`, async () => {
      mocks.load.mockResolvedValueOnce(ok(source(kind)));
      const props = cardProps();
      render(wrap(<NativeSubjectReviewCard {...props} />, locale));
      const heading = screen.getByRole("heading", { name: labels[locale].title });
      expect(heading.closest("[dir]")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
      expect(mocks.load).not.toHaveBeenCalled();
      expect(props.refreshSecurity).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await load(locale);
      expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
      expect(mocks.load).toHaveBeenCalledWith("csrf", { caseId: CASE }, REVIEWER);
      expect(vi.mocked(props.refreshSecurity).mock.invocationCallOrder[0]).toBeLessThan(
        mocks.load.mock.invocationCallOrder[0] ?? 0,
      );
      expect(screen.getByText(labels[locale][kind])).toBeInTheDocument();
      expect(screen.getByText(NAME)).toBeInTheDocument();
      expect(screen.getByText(labels[locale].name)).toBeInTheDocument();
      expect(screen.getByText(labels[locale].created)).toBeInTheDocument();
      expect(screen.getByText(labels[locale].updated)).toBeInTheDocument();
      expect(screen.getByText(dateLabel(CREATED, locale))).toBeInTheDocument();
      expect(screen.getByText(dateLabel(UPDATED, locale))).toBeInTheDocument();
      for (const id of [CASE, SUBJECT])
        for (const reference of screen.getAllByText(id)) {
          expect(reference.closest("bdi")).toHaveAttribute("dir", "ltr");
        }
      if (kind === "person") {
        expect(screen.getByText(labels[locale].firstName)).toBeInTheDocument();
        expect(screen.getByText(labels[locale].lastName)).toBeInTheDocument();
        expect(screen.getByText(labels[locale].emails)).toBeInTheDocument();
        expect(screen.getByText(labels[locale].phones)).toBeInTheDocument();
        expect(screen.getByText(labels[locale].absent)).toBeInTheDocument();
      } else expect(screen.getByText(labels[locale].email)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /export|approve|generate|تأیید درخواست|خروجی|genehmigen|exportieren/iu,
        }),
      ).not.toBeInTheDocument();
    });

test("source text is inert: HTML, URLs and unexpected secret fields do not become active content", async () => {
  const row = source("user");
  const text = '<img src="https://private.example.test/x"> https://private.example.test/value';
  row.record.values.name = text;
  mocks.load.mockResolvedValueOnce(
    ok({
      ...row,
      privateMetadata: "PRIVATE-EXTRA",
      record: { ...row.record, values: { ...row.record.values, secret: "PRIVATE-SECRET" } },
    }),
  );
  const view = render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  await load();
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(view.container.querySelectorAll("img,iframe,script,object,embed")).toHaveLength(0);
  expect(view.container.querySelector('a[href*="private.example.test"]')).toBeNull();
  expect(view.container.textContent).not.toMatch(/PRIVATE-EXTRA|PRIVATE-SECRET/);
});

test("the source boundary blocks replay and private values never enter attributes or tooltips", async () => {
  const view = render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  await load();
  const value = screen.getByText(NAME);
  const boundary = value.closest(`.${BLOCK_CLASS}`);
  expect(boundary).not.toBeNull();
  expect(boundary).toHaveClass("ph-no-capture");
  for (const node of view.container.querySelectorAll("*"))
    for (const attribute of node.attributes) {
      for (const privateValue of [NAME, EMAIL, SUBJECT, CASE, CREATED, UPDATED])
        expect(attribute.value).not.toContain(privateValue);
    }
  expect(view.container.querySelector('[role="tooltip"]')).toBeNull();
});

test("a returned binding for another case never displays its source fields", async () => {
  const row = source();
  row.binding.caseId = NEXT_CASE;
  mocks.load.mockResolvedValueOnce(ok(row));
  render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(labels.en.unavailable, {}, { timeout: 1000 });
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
});

test("refresh clears old fields before waiting, and double-clicks cannot start concurrent loads", async () => {
  const props = cardProps();
  render(wrap(<NativeSubjectReviewCard {...props} />));
  await load();
  const pending = deferred<Awaited<ReturnType<typeof props.refreshSecurity>>>();
  vi.mocked(props.refreshSecurity).mockReturnValueOnce(pending.promise);
  const button = screen.getByRole("button", { name: labels.en.refresh });
  fireEvent.click(button);
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(props.refreshSecurity).toHaveBeenCalledTimes(2);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(() => {
    pending.resolve(ok(props.securityStatus));
    return Promise.resolve();
  });
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2), { timeout: 1000 });
});

test("read-only retry explicitly rechecks current security and refetches without keeping old values", async () => {
  const props = cardProps();
  mocks.load.mockResolvedValueOnce(err("storage_unavailable"));
  render(wrap(<NativeSubjectReviewCard {...props} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(labels.en.unavailable, {}, { timeout: 1000 });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(NAME, {}, { timeout: 1000 });
  expect(props.refreshSecurity).toHaveBeenCalledTimes(2);
  expect(mocks.load.mock.calls.map((call) => call.slice(1))).toEqual([
    [{ caseId: CASE }, REVIEWER],
    [{ caseId: CASE }, REVIEWER],
  ]);
});

for (const kind of ["person", "user"] as const)
  test(`a ${kind} response cannot display values with the opposite verified subject kind`, async () => {
    const row = source(kind);
    row.binding.subject.kind = kind === "person" ? "user" : "contact";
    mocks.load.mockResolvedValueOnce(ok(row));
    render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
      await Promise.resolve();
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", {
        name: /^(Load verified source|Refresh source preview)$/u,
      }),
    ).toBeEnabled();
    expect(screen.queryAllByText(NAME)).toHaveLength(0);
    expect(screen.queryAllByText(EMAIL)).toHaveLength(0);
    expect(screen.queryAllByText(SUBJECT)).toHaveLength(0);
    expect(screen.queryByText(labels.en.unavailable)).toBeInTheDocument();
  });
