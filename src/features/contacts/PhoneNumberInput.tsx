"use client";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { normalizePhoneInput, type PhoneCountry } from "@/utils/phoneNormalization";
import { MAX_PHONE_LEN } from "./fieldBounds";
import { PhoneCountrySelect } from "./PhoneCountrySelect";

export function PhoneNumberInput({
  value,
  country,
  onChange,
  onCountryChange,
  ariaLabel,
  disabled = false,
  id,
  className,
}: {
  value: string;
  country?: PhoneCountry;
  onChange: (value: string) => void;
  onCountryChange: (country: PhoneCountry | undefined) => void;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const t = useAppTranslations("dataConventions");
  const parsed = normalizePhoneInput(value, country);
  const hasValue = value.trim() !== "";
  return (
    <div className={className ?? "min-w-0 flex-1 space-y-1"}>
      <div className="flex min-w-0 items-center gap-2">
        <PhoneCountrySelect
          value={country}
          onChange={onCountryChange}
          disabled={disabled}
          ariaLabel={`${ariaLabel}: ${t("phone.country")}`}
          compact
        />
        <Input
          id={id}
          aria-label={ariaLabel}
          type="tel"
          dir="ltr"
          maxLength={MAX_PHONE_LEN}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
      {hasValue && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {parsed.status === "valid" ? (
            <>
              {t("phone.internationalFormat")}: <bdi dir="ltr">{parsed.e164}</bdi>
            </>
          ) : (
            t(
              parsed.reason === "country_required"
                ? "phone.chooseCountry"
                : parsed.reason === "extension"
                  ? "phone.extension"
                  : "phone.review",
            )
          )}
        </p>
      )}
    </div>
  );
}
