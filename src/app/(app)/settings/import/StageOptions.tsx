"use client";
import { Checkbox } from "@/components/ui/Checkbox";
import { STRINGS } from "@/constants/strings";

const IMP = STRINGS.settings.importer;

export interface StageOptionsProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function StageOptions({ checked, onChange }: StageOptionsProps): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id="create-missing-stages"
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
