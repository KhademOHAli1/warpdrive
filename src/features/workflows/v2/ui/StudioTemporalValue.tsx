"use client";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
export function StudioTemporalValue({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { timeZone } = useLocalePreferences();
  let display = value;
  try {
    const parts = instantParts(value, timeZone);
    display = `${parts.date}T${parts.time}`;
  } catch {
    /* Incomplete authored dates stay editable. */
  }
  return (
    <div className="space-y-1">
      <Input
        aria-label={label}
        type="datetime-local"
        value={display}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          const [date, time] = raw.split("T");
          try {
            onChange(wallTimeToInstant(date ?? "", time ?? "", timeZone).iso);
          } catch {
            onChange(raw);
          }
        }}
        className="h-9 text-xs"
      />
      <p className="text-[10px] text-muted-foreground">{timeZone}</p>
    </div>
  );
}
