import type { PrivacyReviewerCase } from "../reviewerCaseTypes";
import type {
  NativeReviewError,
  NativeSubjectReviewCardProps,
} from "./nativeSubjectReviewCardModel";

export type ReviewerCaseCardProps = NativeSubjectReviewCardProps;
export interface ReviewerCaseCardView {
  boundary: string;
  data: PrivacyReviewerCase | null;
  busy: boolean;
  engaged: boolean;
  error: NativeReviewError | null;
}
export function emptyReviewerCaseCard(boundary: string): ReviewerCaseCardView {
  return { boundary, data: null, busy: false, engaged: false, error: null };
}
