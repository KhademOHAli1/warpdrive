"use client";
import { PhoneCountrySelect } from "@/features/contacts/PhoneCountrySelect";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { PhoneCountry } from "@/utils/phoneNormalization";

export function PhoneImportCountryOption({
  value,
  onChange,
  disabled,
}: {
  value?: PhoneCountry;
  onChange: (country: PhoneCountry | undefined) => void;
  disabled: boolean;
}) {
  const t = useAppTranslations("dataConventions");
  return (
    <div className="max-w-md space-y-1.5">
      <p className="text-sm font-medium">{t("phone.importCountry")}</p>
      <PhoneCountrySelect
        value={value}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={t("phone.importCountry")}
      />
      <p className="text-xs text-muted-foreground">{t("phone.importHint")}</p>
    </div>
  );
}
