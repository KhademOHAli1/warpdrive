import type { SecurityStatus } from "@/features/auth/better/contracts";
import type { Result } from "@/types/result";
import type { PrivacyNativeSubjectReview } from "../nativeSubjectReviewTypes";

export interface NativeSubjectReviewCardProps {
  caseId: string;
  securityStatus: SecurityStatus;
  refreshSecurity: (signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>;
  securityUnavailable?: boolean;
}
export type NativeReviewError = "unavailable" | "fresh" | "verifyEmail" | "account" | "signedOut";
export interface NativeReviewView {
  boundary: string;
  data: PrivacyNativeSubjectReview | null;
  busy: boolean;
  engaged: boolean;
  error: NativeReviewError | null;
}
export type NativeContactPoint = Extract<
  PrivacyNativeSubjectReview["record"],
  { store: "persons" }
>["values"]["emails"][number];
export const nativeReviewFresh = (status: SecurityStatus) =>
  status.emailVerified && status.fresh && !status.needsMfa && !status.needsEnrollment;
export function nativeReviewBoundary(props: NativeSubjectReviewCardProps) {
  return JSON.stringify([
    props.caseId,
    props.securityStatus.user.id,
    props.securityStatus.emailVerified,
    props.securityStatus.fresh,
    props.securityStatus.needsMfa,
    props.securityStatus.needsEnrollment,
    props.securityUnavailable === true,
  ]);
}
export function nativeBoundaryError(
  props: NativeSubjectReviewCardProps,
  reviewerId: string,
): NativeReviewError | null {
  if (props.securityStatus.user.id !== reviewerId) return "account";
  if (props.securityUnavailable ?? false) return "unavailable";
  if (!props.securityStatus.emailVerified) return "verifyEmail";
  return nativeReviewFresh(props.securityStatus) ? null : "fresh";
}
export function emptyNativeReview(boundary: string): NativeReviewView {
  return { boundary, data: null, busy: false, engaged: false, error: null };
}
export function nativeActionError(error: string): NativeReviewError {
  if (error === "reviewer_changed") return "account";
  return error === "fresh_auth_required" ? "fresh" : "unavailable";
}
export function nativeSubjectRecordMatches(subjectKind: string, store: string, recordType: string) {
  return (
    (subjectKind === "contact" && store === "persons" && recordType === "person") ||
    (subjectKind === "user" && store === "users" && recordType === "user")
  );
}
export const NATIVE_TEXT_SEGMENT_UNITS = 4000;
export const NATIVE_CONTACT_PAGE_SIZE = 20;
export function nativeTextBoundary(value: string, nominal: number) {
  const edge = Math.min(nominal, value.length);
  if (edge === 0 || edge === value.length) return edge;
  const before = value.charCodeAt(edge - 1);
  const after = value.charCodeAt(edge);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    ? edge - 1
    : edge;
}
