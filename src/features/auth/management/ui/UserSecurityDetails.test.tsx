// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { ManagedUserDetails } from "../contracts";
import { managementMessagesForLocale } from "../messages";
import type { AskManagementAction } from "./types";
import { UserSecurityDetails } from "./UserSecurityDetails";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const locales = ["en", "de", "fa"] as const;
const failures = ["result", "schema", "transport"] as const;
const cases = locales.flatMap((locale) => failures.map((failure) => ({ locale, failure })));

function details(userId = USER_A, device = "Fixture browser for account A"): ManagedUserDetails {
  return {
    userId,
    emailVerified: true,
    twoFactorEnabled: false,
    passkeyCount: 2,
    providers: ["credential"],
    sessions: [
      {
        id: `fixture-session-${userId}`,
        createdAt: "2026-11-01T12:00:00Z",
        lastSeenAt: "2026-11-02T12:00:00Z",
        expiresAt: "2026-11-08T12:00:00Z",
        userAgent: device,
      },
    ],
  };
}

function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mockFetch() {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function expectOnlyReads(fetcher: ReturnType<typeof mockFetch>, userIds: string[]) {
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
    userIds.map((id) => `/api/auth-management/user?id=${encodeURIComponent(id)}`),
  );
  for (const [, init] of fetcher.mock.calls) {
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
}

function tree({
  locale = "en",
  userId = USER_A,
  revision = "revision-1",
  pending = false,
  ask,
}: {
  locale?: Locale;
  userId?: string;
  revision?: string;
  pending?: boolean;
  ask: AskManagementAction;
}) {
  return (
    <LocaleProvider locale={locale}>
      <UserSecurityDetails
        L={managementMessagesForLocale(locale)}
        userId={userId}
        revision={revision}
        pending={pending}
        ask={ask}
      />
    </LocaleProvider>
  );
}

describe("Managed security-details read recovery", () => {
  it.each(cases)(
    "retries a $failure read in $locale without issuing a command",
    async ({ locale, failure }) => {
      const L = managementMessagesForLocale(locale);
      const fetcher = mockFetch();
      if (failure === "result")
        fetcher.mockResolvedValueOnce(Response.json({ ok: false, error: "forbidden" }));
      else if (failure === "schema")
        fetcher.mockResolvedValueOnce(Response.json({ ok: true, data: { userId: USER_A } }));
      else fetcher.mockRejectedValueOnce(new Error("private read diagnostic"));
      const retryRead = deferred();
      fetcher.mockReturnValueOnce(retryRead.promise);
      const ask = vi.fn<AskManagementAction>();
      render(tree({ locale, ask }));
      expect(await screen.findByRole("alert")).toHaveTextContent(L.loadError);
      expect(screen.queryByRole("heading", { name: L.securityDetails })).not.toBeInTheDocument();
      expect(screen.queryByText("private read diagnostic")).not.toBeInTheDocument();
      const retry = screen.getByRole("button", { name: L.retry });
      retry.focus();
      act(() => {
        fireEvent.click(retry);
        fireEvent.click(retry);
      });
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("status")).toHaveTextContent(L.loading);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      const output = screen.getByRole("region", { name: L.securityDetails });
      expect(output).toHaveFocus();
      fireEvent.click(retry);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await act(async () => {
        retryRead.resolve(Response.json({ ok: true, data: details() }));
        await retryRead.promise;
      });
      expect(await screen.findByRole("heading", { name: L.securityDetails })).toBeInTheDocument();
      expect(screen.getByText("Fixture browser for account A")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: L.retry })).not.toBeInTheDocument();
      expect(output).toHaveFocus();
      expect(ask).not.toHaveBeenCalled();
      expectOnlyReads(fetcher, [USER_A, USER_A]);
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
    },
  );

  it("hides old-account data and ignores an aborted revision read after the identity changes", async () => {
    const L = managementMessagesForLocale("en");
    const fetcher = mockFetch().mockResolvedValueOnce(Response.json({ ok: true, data: details() }));
    const oldRevision = deferred();
    const nextAccount = deferred();
    fetcher.mockReturnValueOnce(oldRevision.promise).mockReturnValueOnce(nextAccount.promise);
    const ask = vi.fn<AskManagementAction>();
    const view = render(tree({ ask }));
    expect(await screen.findByText("Fixture browser for account A")).toBeInTheDocument();
    view.rerender(tree({ ask, revision: "revision-2" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const oldSignal = fetcher.mock.calls[1]?.[1]?.signal;
    view.rerender(tree({ ask, userId: USER_B, revision: "revision-2" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(L.loading);
    expect(screen.queryByText("Fixture browser for account A")).not.toBeInTheDocument();
    await act(async () => {
      nextAccount.resolve(
        Response.json({ ok: true, data: details(USER_B, "Fixture browser for account B") }),
      );
      await nextAccount.promise;
    });
    expect(await screen.findByText("Fixture browser for account B")).toBeInTheDocument();
    await act(async () => {
      oldRevision.resolve(
        Response.json({ ok: true, data: details(USER_A, "Stale account A response") }),
      );
      await oldRevision.promise;
    });
    expect(screen.getByText("Fixture browser for account B")).toBeInTheDocument();
    expect(screen.queryByText("Stale account A response")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    expectOnlyReads(fetcher, [USER_A, USER_A, USER_B]);
  });

  it("rejects a successful response for another account and retries the requested identity", async () => {
    const L = managementMessagesForLocale("en");
    const fetcher = mockFetch()
      .mockResolvedValueOnce(
        Response.json({ ok: true, data: details(USER_B, "Other account response") }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, data: details() }));
    const ask = vi.fn<AskManagementAction>();
    render(tree({ ask }));
    expect(await screen.findByRole("alert")).toHaveTextContent(L.loadError);
    expect(screen.queryByText("Other account response")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.retry }));
    expect(await screen.findByText("Fixture browser for account A")).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    expectOnlyReads(fetcher, [USER_A, USER_A]);
  });

  it("keeps Retry gated while a parent management command is pending", async () => {
    const L = managementMessagesForLocale("en");
    const fetcher = mockFetch()
      .mockRejectedValueOnce(new Error("read unavailable"))
      .mockResolvedValueOnce(Response.json({ ok: true, data: details() }));
    const ask = vi.fn<AskManagementAction>();
    const view = render(tree({ ask, pending: true }));
    await screen.findByRole("alert");
    const retry = screen.getByRole("button", { name: L.retry });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.rerender(tree({ ask, pending: false }));
    fireEvent.click(screen.getByRole("button", { name: L.retry }));
    expect(await screen.findByText("Fixture browser for account A")).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    expectOnlyReads(fetcher, [USER_A, USER_A]);
  });

  it("aborts a pending retry on unmount and ignores its late rejection", async () => {
    const L = managementMessagesForLocale("en");
    const fetcher = mockFetch().mockRejectedValueOnce(new Error("read unavailable"));
    const retryRead = deferred();
    fetcher.mockReturnValueOnce(retryRead.promise);
    const ask = vi.fn<AskManagementAction>();
    const view = render(tree({ ask }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: L.retry }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const signal = fetcher.mock.calls[1]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      retryRead.reject(new Error("late aborted read"));
      await retryRead.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: L.securityDetails })).not.toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    expectOnlyReads(fetcher, [USER_A, USER_A]);
  });
});
