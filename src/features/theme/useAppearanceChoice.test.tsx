// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PrefActionResult = { ok: true } | { ok: false; error: { id: string } };
const setAppearanceAction = vi.hoisted(() =>
  vi.fn((): Promise<PrefActionResult> => Promise.resolve({ ok: true })),
);
const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/features/identity/preferencesActions", () => ({ setAppearanceAction }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => reportError }));

import { APPEARANCE_COOKIE, APPEARANCE_VALUES, type Appearance, DARK_CLASS } from "./appearance";
import { useAppearanceChoice } from "./useAppearanceChoice";

const LABELS: Record<Appearance, string> = { day: "Day", night: "Night", system: "System" };

// The smallest thing that can click. Ordering and rollback belong to the hook, not to whichever
// control renders it, so they are exercised here rather than through the account menu.
function Harness({ value }: { value: Appearance }): React.ReactNode {
  const choice = useAppearanceChoice(value);
  return (
    <>
      <output aria-label="Theme save">{choice.status}</output>
      <button type="button" onClick={choice.retry}>
        Retry theme
      </button>
      {APPEARANCE_VALUES.map((option) => (
        <label key={option}>
          {LABELS[option]}
          <input
            type="radio"
            name="appearance"
            checked={choice.value === option}
            onChange={() => choice.choose(option)}
          />
        </label>
      ))}
    </>
  );
}

beforeEach(() => {
  document.documentElement.className = "";
  document.cookie = `${APPEARANCE_COOKIE}=; max-age=0; path=/`;
  setAppearanceAction.mockReset();
  reportError.mockClear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

describe("useAppearanceChoice feedback and recovery", () => {
  it("paints and writes the cookie immediately, but confirms saving only after the response", async () => {
    const response = deferred();
    setAppearanceAction.mockReturnValueOnce(response.promise);
    render(<Harness value="day" />);
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("idle");

    pick("Night");
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(document.cookie).toContain(`${APPEARANCE_COOKIE}=night`);
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saving");
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(1));

    response.settle({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saved"),
    );
    expect(screen.getByRole("radio", { name: "Night" })).toBeChecked();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("keeps saving feedback for the latest pick when an earlier success lands", async () => {
    const first = deferred();
    const second = deferred();
    setAppearanceAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Harness value="day" />);
    pick("Night");
    pick("System");
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(1));

    first.settle({ ok: true });
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saving");
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(document.cookie).toContain(`${APPEARANCE_COOKIE}=system`);

    second.settle({ ok: false, error: { id: "E_DB_001" } });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("error"),
    );
    expect(screen.getByRole("radio", { name: "Night" })).toBeChecked();
    expect(document.cookie).toContain(`${APPEARANCE_COOKIE}=night`);
    expect(reportError).toHaveBeenCalledExactlyOnceWith("E_DB_001");
  });

  it("ignores stale failure feedback while the newest choice is still saving", async () => {
    const first = deferred();
    const second = deferred();
    setAppearanceAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Harness value="day" />);
    pick("Night");
    pick("System");
    first.settle({ ok: false, error: { id: "E_DB_001" } });
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saving");
    expect(reportError).not.toHaveBeenCalled();
    second.settle({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saved"),
    );
  });

  it("retries the failed choice after rollback through the same save path only once", async () => {
    const retry = deferred();
    setAppearanceAction
      .mockRejectedValueOnce(new Error("private database diagnostic"))
      .mockReturnValueOnce(retry.promise);
    render(<Harness value="day" />);
    pick("Night");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("error"),
    );
    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Retry theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry theme" }));
    expect(screen.getByRole("radio", { name: "Night" })).toBeChecked();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saving");
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));
    expect(setAppearanceAction).toHaveBeenNthCalledWith(2, { appearance: "night" }, "csrf");
    retry.settle({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saved"),
    );
    expect(reportError).toHaveBeenCalledExactlyOnceWith("E_DB_003");
  });

  it("clears an obsolete retry when a new choice succeeds", async () => {
    setAppearanceAction
      .mockResolvedValueOnce({ ok: false, error: { id: "E_DB_001" } })
      .mockResolvedValueOnce({ ok: true });
    render(<Harness value="day" />);
    pick("Night");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("error"),
    );
    pick("System");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saved"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry theme" }));
    expect(setAppearanceAction).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("follows System changes during saving, after success, and after a failed pick rolls back", async () => {
    const listeners = new Set<() => void>();
    const mq = {
      matches: false,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("matchMedia", () => mq);
    const response = deferred();
    setAppearanceAction
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce({ ok: false, error: { id: "E_DB_001" } });
    render(<Harness value="day" />);
    pick("System");
    act(() => {
      mq.matches = true;
      for (const listener of listeners) listener();
    });
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saving");
    response.settle({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("saved"),
    );
    act(() => {
      mq.matches = false;
      for (const listener of listeners) listener();
    });
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);

    pick("Night");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Theme save" })).toHaveTextContent("error"),
    );
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    act(() => {
      mq.matches = true;
      for (const listener of listeners) listener();
    });
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    cleanup();
    expect(listeners.size).toBe(0);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Deferred promise so a test controls exactly when each save settles.
function deferred(): { promise: Promise<PrefActionResult>; settle: (r: PrefActionResult) => void } {
  let settle!: (r: PrefActionResult) => void;
  const promise = new Promise<PrefActionResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function pick(name: string): void {
  fireEvent.click(screen.getByRole("radio", { name }));
}

// Two picks in quick succession race: each save captured the appearance in effect when it started,
// so an older one settling last must not speak for the newer one.
describe("useAppearanceChoice concurrent saves", () => {
  it("keeps the newest choice when an older save fails after it", async () => {
    const first = deferred();
    const second = deferred();
    setAppearanceAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<Harness value="day" />);
    pick("Night");
    pick("Day");

    second.settle({ ok: true });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Day" })).toBeChecked());

    // The stale Night save now fails. Reverting to its own baseline would undo the Day the user
    // is looking at, and report an error about a choice they already moved off.
    first.settle({ ok: false, error: { id: "E_DB_001" } });
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  // Ignoring a stale response is not enough: if both writes are in flight, the older one can still
  // land last and leave the durable preference disagreeing with the screen.
  it("does not start a save until the one before it has landed", async () => {
    const first = deferred();
    setAppearanceAction.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });

    render(<Harness value="day" />);
    pick("Night");
    pick("System");

    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(1));
    expect(setAppearanceAction).toHaveBeenLastCalledWith({ appearance: "night" }, "csrf");

    first.settle({ ok: true });
    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));
    expect(setAppearanceAction).toHaveBeenLastCalledWith({ appearance: "system" }, "csrf");
  });

  it("reverts and reports when the save throws instead of answering", async () => {
    setAppearanceAction.mockRejectedValue(new Error("postgres is unreachable"));

    render(<Harness value="day" />);
    pick("Night");

    await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_DB_003"));
    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  // A queued save that succeeded is what the database holds, so it becomes the baseline. Rolling
  // a later failure back past it would revert to a choice the database no longer stores, and the
  // next reload would then change the theme again.
  it("rolls a failure back to the last save that landed, not to the original", async () => {
    const second = deferred();
    setAppearanceAction.mockResolvedValueOnce({ ok: true }).mockReturnValueOnce(second.promise);

    render(<Harness value="day" />);
    pick("Night");
    pick("System");

    await waitFor(() => expect(setAppearanceAction).toHaveBeenCalledTimes(2));
    second.settle({ ok: false, error: { id: "E_DB_001" } });

    // Night is what the database stores, so that is where the failed System save lands.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Night" })).toBeChecked());
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("still reports a failure when it is the newest save that failed", async () => {
    setAppearanceAction.mockResolvedValue({ ok: false, error: { id: "E_DB_001" } });

    render(<Harness value="day" />);
    pick("Night");

    await waitFor(() => expect(reportError).toHaveBeenCalledWith("E_DB_001"));
    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();
  });
});
