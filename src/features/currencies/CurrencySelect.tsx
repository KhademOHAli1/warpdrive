"use client";

import { useMemo } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { CURRENCY_CODES } from "./codes";

export function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const locale = useLocale();
  const t = useAppTranslations("sales");
  const options = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    const codes = CURRENCY_CODES.includes(value) ? CURRENCY_CODES : [value, ...CURRENCY_CODES];
    return codes.map((code) => ({
      value: code,
      label: `${code} · ${names.of(code) ?? code}`,
    }));
  }, [locale, value]);
  return (
    <Combobox ariaLabel={t("currencyLabel")} value={value} onChange={onChange} options={options} />
  );
}
