// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import { ProviderCard } from "./ProviderCard";

const S = settingsMessagesForLocale("en")._enrichment.settings;
const retryCopy = "We could not confirm the key save. Your entry is still here. Try saving again.";

afterEach(cleanup);

function renderCard(onSaveKey: (key: string) => Promise<boolean>) {
  render(
    <ProviderCard
      view={{
        provider: "apollo",
        name: "Apollo",
        enabled: true,
        hasKey: true,
        apiKeyHint: "9f2a",
        throttledUntilIso: null,
        throttleReason: null,
        needsAttention: false,
      }}
      now={null}
      onSaveKey={onSaveKey}
      onToggle={vi.fn()}
      onRemoveKey={vi.fn()}
      onTest={vi.fn()}
    />,
  );
  const field = screen.getByLabelText(S.apiKeyLabel);
  fireEvent.change(field, { target: { value: "  replacement-key  " } });
  return field;
}

describe("ProviderCard key save recovery", () => {
  it("keeps the draft after a failed save and clears it only after a successful retry", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const field = renderCard(save);
    fireEvent.click(screen.getByRole("button", { name: S.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(retryCopy);
    expect(field).toHaveValue("  replacement-key  ");
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(save).toHaveBeenNthCalledWith(2, "replacement-key");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the draft and explains retry when a save rejects", async () => {
    const field = renderCard(vi.fn().mockRejectedValue(new Error("offline")));
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(retryCopy);
    expect(field).toHaveValue("  replacement-key  ");
    expect(field).toBeEnabled();
  });

  it("blocks repeated submissions and conflicting controls until the same save settles", async () => {
    let finish: (saved: boolean) => void = vi.fn();
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const field = renderCard(save);
    const button = screen.getByRole("button", { name: S.save });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue("  replacement-key  ");
    expect(field).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: S.saving })).toBeDisabled();
    expect(screen.getByRole("button", { name: S.test })).toBeDisabled();
    expect(screen.getByRole("button", { name: S.remove })).toBeDisabled();
    await act(async () => {
      finish(true);
      await Promise.resolve();
    });
    expect(field).toHaveValue("");
    expect(field).toBeEnabled();
  });
});
