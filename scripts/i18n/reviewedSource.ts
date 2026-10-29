import type { SourceFinding } from "./auditSource";

export interface ReviewedSource {
  id: string;
  file: string;
  text: string;
  reason: string;
}

export function partitionReviewedSources(findings: SourceFinding[], reviews: ReviewedSource[]) {
  const matches = (finding: SourceFinding, review: ReviewedSource) =>
    finding.id === review.id && finding.file === review.file && finding.text === review.text;
  return {
    remaining: findings.filter((finding) => !reviews.some((review) => matches(finding, review))),
    reviewed: reviews.filter((review) => findings.some((finding) => matches(finding, review))),
    stale: reviews.filter((review) => !findings.some((finding) => matches(finding, review))),
  };
}
