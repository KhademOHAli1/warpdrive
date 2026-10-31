"use client";
import { Checkbox } from "@/components/ui/Checkbox";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

export interface StageOptionsProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function StageOptions({
  checked,
  disabled = false,
  onChange,
}: StageOptionsProps): React.ReactNode {
  const IMP = useSettingsMessages().importer;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id="create-missing-stages"
          disabled={disabled}
          checked={checked}
          onCheckedChange={onChange}
          label={IMP.createMissingStages}
        />
        <label htmlFor="create-missing-stages" className="cursor-pointer text-sm font-medium">
          {IMP.createMissingStages}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{IMP.createMissingStagesHint}</p>
    </div>
  );
}
