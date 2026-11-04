import type { ConfigurationIssueCode } from "../configurationTypes";
export const configurationIssueKeys = {
  required: "configurationRequired",
  invalid_type: "configurationInvalidType",
  invalid_value: "configurationInvalidValue",
  too_long: "configurationTooLong",
  out_of_range: "configurationOutOfRange",
  unknown_setting: "configurationUnknownSetting",
  unknown_field: "configurationUnknownField",
  field_archived: "configurationArchivedField",
  option_unavailable: "configurationOptionUnavailable",
  reference_missing: "configurationReferenceMissing",
  reference_incompatible: "configurationReferenceIncompatible",
  reference_unavailable: "configurationReferenceUnavailable",
  unsupported_setting: "configurationUnsupportedSetting",
  metadata_incomplete: "configurationMetadataIncomplete",
  metadata_stale: "configurationMetadataStale",
  literal_number_invalid: "configurationLiteralNumberInvalid",
  literal_date_invalid: "configurationLiteralDateInvalid",
  literal_instant_invalid: "configurationLiteralInstantInvalid",
} as const satisfies Record<ConfigurationIssueCode, string>;

export type ConfigurationIssueKey = (typeof configurationIssueKeys)[ConfigurationIssueCode];
