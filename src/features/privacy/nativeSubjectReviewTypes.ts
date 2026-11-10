import type { z } from "zod";
import type { disclosureFieldSchemas } from "./disclosureFields";

type Values<Fields extends Record<string, z.ZodType>> = {
  [Key in keyof Fields]: z.output<Fields[Key]>;
};
export type PrivacyNativeSubjectRecord = {
  adapterVersion: 1;
  recordId: string;
  sourceFingerprint: string;
} & (
  | { store: "persons"; recordType: "person"; values: Values<typeof disclosureFieldSchemas.person> }
  | { store: "users"; recordType: "user"; values: Values<typeof disclosureFieldSchemas.user> }
);
export interface PrivacyNativeSubjectReview {
  formatVersion: 1;
  state: "preliminary";
  complete: false;
  reviewRequired: true;
  binding: {
    caseId: string;
    caseVersion: number;
    subject: { kind: "contact" | "user"; referenceId: string };
    identityScopeVersion: number;
    recipientVersion: number;
    verificationVersion: number;
    policyVersion: number;
    policyGeneration: number;
  };
  record: PrivacyNativeSubjectRecord;
  coverage: {
    store: string;
    status: "incomplete" | "unsupported";
    code: "direct_subject_only" | "not_loaded" | "adapter_unavailable";
  }[];
}
export type PrivacyNativeSubjectReviewFailure =
  | "invalid_input"
  | "forbidden"
  | "case_not_reviewable"
  | "policy_unconfigured"
  | "policy_stale"
  | "policy_disabled"
  | "unsupported_subject"
  | "source_unavailable"
  | "source_invalid"
  | "source_limit"
  | "storage_unavailable";
