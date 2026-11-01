// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { expectPrivateReplay } from "@/features/auth/ui/__fixtures__/SecurityReplayPrivacyTestKit";
import { err, ok } from "@/types/result";
import {
  CASE_ID,
  currentCase,
  deferred,
  labels,
  loaded,
  mocks,
  refresh,
  security,
  settle,
  showCase,
} from "./__fixtures__/OwnPrivacyCaseStatusTestKit";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(ok(currentCase));
  mocks.verify.mockResolvedValue(ok({ ...currentCase, version: 4 }));
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "renders the %s minimal private status and canonical received time",
  async (locale) => {
    const { view } = showCase(locale);
    await loaded(locale);
    expect(screen.getByRole("heading", { name: labels[locale].title })).toBeInTheDocument();
    expect(screen.getByText(labels[locale].kind)).toBeInTheDocument();
    expect(screen.getByText(labels[locale].noDeadline)).toBeInTheDocument();
    const reference = screen.getByText(CASE_ID);
    expect(reference.closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(reference.closest(".ph-no-capture")).not.toBeNull();
    const time = view.container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", currentCase.receivedAt.toISOString());
    expect(time?.textContent).not.toContain("2026-03-21T");
    if (locale === "fa") expect(time?.textContent).toMatch(/[۰-۹]/u);
    expect(mocks.read).toHaveBeenCalledWith("csrf", { caseId: CASE_ID });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /download|cancel/iu })).not.toBeInTheDocument();
  },
);

test("initial loading is explicit and performs no confirmation", async () => {
  const pending = deferred<ReturnType<typeof ok<typeof currentCase>>>();
  mocks.read.mockReturnValueOnce(pending.promise);
  showCase();
  expect(screen.getByRole("status")).toHaveTextContent(labels.en.loading);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce(), { timeout: 1000 });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(mocks.verify).not.toHaveBeenCalled();
  await settle(pending, ok(currentCase));
  await loaded();
});

test("the installed recorder and autocapture exclude a live private reference with a public sibling control", async () => {
  showCase();
  await loaded();
  expectPrivateReplay(screen.getByText(CASE_ID), [CASE_ID]);
});

test("an explicit refresh displays current status and a recorded due date without mutating", async () => {
  mocks.read.mockResolvedValueOnce(ok(currentCase)).mockResolvedValueOnce(
    ok({
      ...currentCase,
      status: "under_review",
      version: 7,
      dueAt: new Date("2026-04-21T00:30:00Z"),
    }),
  );
  const { view, refreshSecurity } = showCase();
  await loaded();
  refresh();
  await screen.findByText("Under review", {}, { timeout: 1000 });
  expect(refreshSecurity).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(view.container.querySelectorAll("time")).toHaveLength(2);
  expect(screen.queryByText(labels.en.noDeadline)).not.toBeInTheDocument();
  expect(mocks.verify).not.toHaveBeenCalled();
});

test.each(["not_found", "forbidden"])(
  "%s exposes no request or another account's state",
  async (error) => {
    mocks.read.mockResolvedValueOnce(err(error));
    showCase();
    expect(await screen.findByRole("alert", {}, { timeout: 1000 })).toHaveTextContent(
      labels.en.unavailable,
    );
    expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.en.confirm })).not.toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  },
);

test("transport details stay private and a failed security refresh cannot dispatch a read retry", async () => {
  mocks.read.mockRejectedValueOnce(new Error("PRIVATE-driver-response"));
  const { refreshSecurity } = showCase();
  expect(await screen.findByRole("alert", {}, { timeout: 1000 })).toHaveTextContent(
    labels.en.failed,
  );
  expect(document.body).not.toHaveTextContent("PRIVATE-driver-response");
  refreshSecurity.mockResolvedValueOnce(err("unavailable"));
  refresh();
  await waitFor(() => expect(refreshSecurity).toHaveBeenCalledOnce(), { timeout: 1000 });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await waitFor(
    () => expect(screen.getByRole("button", { name: labels.en.refresh })).not.toBeDisabled(),
    { timeout: 1000 },
  );
  refresh();
  await loaded();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

test("nonfresh account status requires confirmation and an explicit read retry", async () => {
  const { refreshSecurity } = showCase("en", { ...security, fresh: false });
  expect(
    await screen.findByLabelText("Current password", {}, { timeout: 1000 }),
  ).toBeInTheDocument();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  refreshSecurity.mockResolvedValueOnce(ok(security));
  refresh();
  await loaded();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.verify).not.toHaveBeenCalled();
});
