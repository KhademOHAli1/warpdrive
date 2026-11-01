import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ok } from "@/types/result";
import { PrivateIntakePanel, type PrivateIntakePanelProps } from "./PrivateIntakePanel";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

export const intakeSummary: PrivateIntakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: 4,
  state: "unverified",
  contentState: "retained",
  decision: null,
};

export function deferred<Value>() {
  let settle: (value: Value) => void = () => {};
  const promise = new Promise<Value>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value: Value) => settle(value) };
}

export function renderPrivateIntake(
  overrides: Partial<PrivateIntakePanelProps> = {},
  locale: Locale = "en",
) {
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>((input) =>
    Promise.resolve(
      ok({
        ...intakeSummary,
        id: input.intakeId,
        revision: input.expectedRevision + 1,
        decision: input.decision,
      }),
    ),
  );
  const onReviewed = vi.fn();
  let props: PrivateIntakePanelProps = {
    isOwner: true,
    summary: intakeSummary,
    onReview,
    onReviewed,
    ...overrides,
  };
  const tree = () => (
    <LocaleProvider locale={locale}>
      <PrivateIntakePanel {...props} />
    </LocaleProvider>
  );
  const view = render(tree());
  return {
    ...view,
    onReview,
    onReviewed,
    user: userEvent.setup(),
    update: (next: Partial<PrivateIntakePanelProps>) => {
      props = { ...props, ...next };
      view.rerender(tree());
    },
  };
}
