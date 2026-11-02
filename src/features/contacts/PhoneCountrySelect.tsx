"use client";
import { getCountryCallingCode } from "libphonenumber-js/max";
import { useMemo } from "react";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { isPhoneCountry, PHONE_COUNTRIES, type PhoneCountry } from "@/utils/phoneNormalization";

export function PhoneCountrySelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  compact = false,
}: {
  value?: PhoneCountry;
  onChange: (country: PhoneCountry | undefined) => void;
  disabled?: boolean;
  ariaLabel?: string;
  compact?: boolean;
}) {
  const locale = useLocale();
  const t = useAppTranslations("dataConventions");
  const options = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    const all = PHONE_COUNTRIES.map((country) => ({
      value: country,
      label: `${names.of(country) ?? country} (+${getCountryCallingCode(country)})`,
    })).sort((a, b) => a.label.localeCompare(b.label, locale));
    return [{ value: "international", label: t("phone.international") }, ...all];
  }, [locale, t]);
  return (
    <Select
      value={value ?? "international"}
      onChange={(country) => onChange(isPhoneCountry(country) ? country : undefined)}
      options={options}
      ariaLabel={ariaLabel ?? t("phone.country")}
      disabled={disabled}
      triggerClassName={compact ? "w-32 shrink-0 text-xs" : undefined}
    />
  );
}
