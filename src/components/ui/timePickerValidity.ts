// Manual action buttons need the same constraint check as a native form submission. Scope it
// to TimePicker inputs so unrelated entity validation keeps its existing localized behavior.
export function reportTimePickerValidity(scope: ParentNode | null): boolean {
  const invalid = scope?.querySelector<HTMLInputElement>("input[data-time-picker]:invalid");
  if (invalid == null) return true;
  invalid.reportValidity();
  invalid.focus();
  return false;
}
