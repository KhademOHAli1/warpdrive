"use server";

import { invokeAction } from "@/frontend/actions";

import type * as ImplementationModule from "./reviewerActions.backend";

type Implementation = typeof ImplementationModule;

export type * from "./reviewerActions.backend";

export async function listPrivacyIntakeQueueAction(
  ...args: Parameters<Implementation["listPrivacyIntakeQueueAction"]>
): ReturnType<Implementation["listPrivacyIntakeQueueAction"]> {
  return invokeAction("features/privacy/reviewerActions.listPrivacyIntakeQueueAction", args);
}

export async function claimPrivacyCaseAction(
  ...args: Parameters<Implementation["claimPrivacyCaseAction"]>
): ReturnType<Implementation["claimPrivacyCaseAction"]> {
  return invokeAction("features/privacy/reviewerActions.claimPrivacyCaseAction", args);
}

export async function loadPrivacyNativeSubjectReviewAction(
  ...args: Parameters<Implementation["loadPrivacyNativeSubjectReviewAction"]>
): ReturnType<Implementation["loadPrivacyNativeSubjectReviewAction"]> {
  return invokeAction(
    "features/privacy/reviewerActions.loadPrivacyNativeSubjectReviewAction",
    args,
  );
}

export async function readPrivacyReviewerCaseAction(
  ...args: Parameters<Implementation["readPrivacyReviewerCaseAction"]>
): ReturnType<Implementation["readPrivacyReviewerCaseAction"]> {
  return invokeAction("features/privacy/reviewerActions.readPrivacyReviewerCaseAction", args);
}

export async function transitionPrivacyCaseAction(
  ...args: Parameters<Implementation["transitionPrivacyCaseAction"]>
): ReturnType<Implementation["transitionPrivacyCaseAction"]> {
  return invokeAction("features/privacy/reviewerActions.transitionPrivacyCaseAction", args);
}
