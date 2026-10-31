"use client";
import { Select } from "@/components/ui/Select";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { formatCurrency } from "@/lib/formatCurrency";

export function IranianMoneySetting() {
  const t = useAppTranslations("dataConventions");
  const preferences = useLocalePreferences();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{t("money.unit")}</p>
      <Select
        ariaLabel={t("money.unit")}
        value={preferences.iranianMoneyUnit ?? "rial"}
        disabled={pending}
        options={[
          { value: "rial", label: t("money.rial") },
          { value: "toman", label: t("money.toman", { factor: 10 }) },
        ]}
        onChange={(iranianMoneyUnit) => {
          if (iranianMoneyUnit === "rial" || iranianMoneyUnit === "toman")
            void choose({ iranianMoneyUnit });
        }}
      />
      <p className="text-sm text-muted-foreground">{t("money.help")}</p>
      <p className="text-sm tabular-nums" aria-live="polite">
        <span className="text-muted-foreground">{t("money.preview")}: </span>
        <bdi dir="auto">{formatCurrency("1234560", "IRR", preferences)}</bdi>
      </p>
    </div>
  );
}
