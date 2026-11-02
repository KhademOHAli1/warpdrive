// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DeliveryReportsPanel } from "./DeliveryReportsPanel";
import {
  deliveryUiLabels,
  deliveryUiPrimaryTarget,
  deliveryUiRecipient,
  deliveryUiReport,
  deliveryUiSecondTarget,
  deliveryUiTargets,
  deliveryUiIds as ids,
} from "./deliveryObservationUiFixtures";

afterEach(cleanup);

// Same jsdom shims as the design-system Select tests; the actual Radix controls remain mounted.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

function successfulReview() {
  return vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: {
        revision: 1,
        decision: "associated" as const,
        target: { attemptId: ids.attempt, recipient: "Kunde@example.test", kind: "to" as const },
      },
    }),
  );
}

function chooseOption(label: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function chooseTarget(locale: keyof typeof deliveryUiLabels) {
  const L = deliveryUiLabels[locale];
  fireEvent.click(screen.getByRole("button", { name: L.review }));
  chooseOption(L.sentEmail, /Angebot zur Zusammenarbeit/u);
  chooseOption(L.recipient, /Kunde@example\.test/u);
}

describe.each(["fa", "de", "en"] as const)("owner-only delivery report panel in %s", (locale) => {
  const L = deliveryUiLabels[locale];

  it("labels the observation unverified without linking or resending anything automatically", () => {
    const onReview = successfulReview();
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("region", { name: L.title })).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    expect(screen.getByText(L.warning)).toBeVisible();
    expect(screen.getByText(L.reportedFailure)).toBeVisible();
    expect(screen.getByText("Kunde@example.test").closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(onReview).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /resend|ارسال دوباره|erneut senden/iu }),
    ).not.toBeInTheDocument();
  });

  it("requires a deliberate target, recipient, and confirmation before saving an association", async () => {
    const onReview = successfulReview();
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    const save = screen.getByRole("button", { name: L.save });
    expect(save).toBeDisabled();
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toHaveTextContent(
      L.chooseSentEmail,
    );
    chooseOption(L.sentEmail, /Angebot zur Zusammenarbeit/u);
    expect(screen.getByRole("combobox", { name: L.recipient })).toHaveTextContent(
      L.chooseRecipient,
    );
    chooseOption(L.recipient, /Kunde@example\.test/u);
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(save);
    expect(onReview).toHaveBeenCalledExactlyOnceWith({
      reportId: ids.report,
      recipientIndex: 0,
      expectedRevision: 0,
      decision: "associate",
      confirmUnverified: true,
      target: { attemptId: ids.attempt, recipient: "Kunde@example.test" },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
    expect(screen.getByText(L.warning)).toBeVisible();
  });

  it("clears the recipient and prior confirmation when the target changes, even for the same address", async () => {
    const onReview = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          revision: 1,
          decision: "associated" as const,
          target: {
            attemptId: ids.secondAttempt,
            recipient: "Kunde@example.test",
            kind: "to" as const,
          },
        },
      }),
    );
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    chooseTarget(locale);
    const confirmation = screen.getByRole("checkbox", { name: L.confirmation });
    fireEvent.click(confirmation);
    expect(screen.getByRole("button", { name: L.save })).toBeEnabled();

    chooseOption(L.sentEmail, /Rückfrage zum Angebot/u);
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toHaveTextContent(
      deliveryUiSecondTarget.subject,
    );
    expect(screen.getByRole("combobox", { name: L.recipient })).toHaveTextContent(
      L.chooseRecipient,
    );
    expect(screen.getByRole("checkbox", { name: L.confirmation })).not.toBeChecked();
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    expect(onReview).not.toHaveBeenCalled();

    chooseOption(L.recipient, /Kunde@example\.test/u);
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith({
      reportId: ids.report,
      recipientIndex: 0,
      expectedRevision: 0,
      decision: "associate",
      confirmUnverified: true,
      target: { attemptId: ids.secondAttempt, recipient: "Kunde@example.test" },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
  });

  it("supports an explicit dismissal without choosing or altering a send", async () => {
    const onReview = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { revision: 1, decision: "dismissed" as const, target: null },
      }),
    );
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    const dismiss = screen.getByRole("button", { name: L.dismiss });
    expect(dismiss).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(dismiss);
    expect(onReview).toHaveBeenCalledExactlyOnceWith({
      reportId: ids.report,
      recipientIndex: 0,
      expectedRevision: 0,
      decision: "dismiss",
      confirmUnverified: true,
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
  });

  it("preserves the review on a safe failure and never renders exception messages", async () => {
    const onReview = vi.fn(() => Promise.reject(new Error("synthetic-secret-provider-response")));
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    chooseTarget(locale);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(L.failure);
    expect(screen.queryByText(/synthetic-secret/u)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toHaveTextContent(
      deliveryUiPrimaryTarget.subject,
    );
    expect(screen.getByRole("combobox", { name: L.recipient })).toHaveTextContent(
      "Kunde@example.test",
    );
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("stops after changed access without automatic resubmission or adding a fresh-auth requirement", async () => {
    const onReview = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: "permission" as const }),
    );
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    chooseTarget(locale);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(L.permission);
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("stops a stale review after a concurrent edit rather than silently overwriting it", async () => {
    const onReview = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: "conflict" as const }),
    );
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    chooseTarget(locale);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(L.conflict);
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("never exposes hidden metadata or counts to a nonowner, even if given stale props", () => {
    const { container } = render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner={false}
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={successfulReview()}
        />
      </LocaleProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders diagnostic markup as text with no active links or resource requests", () => {
    const diagnostic =
      '<img src="https://untrusted.example.test/pixel"><script>sendSecrets()</script>';
    const report = {
      ...deliveryUiReport,
      recipients: [
        {
          ...deliveryUiRecipient,
          diagnostic: { type: "smtp", text: diagnostic, display: "plain_text" as const },
          localizedDiagnostics: [],
        },
      ],
    };
    const { container } = render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[report]}
          targets={deliveryUiTargets}
          onReview={successfulReview()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(diagnostic)).toBeVisible();
    expect(container.querySelector("img,script,a[href^='https://untrusted']")).toBeNull();
  });

  it("does not duplicate a review while its first request is pending", async () => {
    let finish!: (value: Awaited<ReturnType<ReturnType<typeof successfulReview>>>) => void;
    const onReview = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<ReturnType<typeof successfulReview>>>>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[deliveryUiReport]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>,
    );
    chooseTarget(locale);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(onReview).toHaveBeenCalledTimes(1);
    finish({
      ok: true,
      value: {
        revision: 1,
        decision: "associated",
        target: { attemptId: ids.attempt, recipient: "Kunde@example.test", kind: "to" },
      },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
  });
});
