import { Check, ChevronsUpDown } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import type { ComboboxOption } from "./Combobox";

export function ComboboxTriggerLabel({
  option,
  placeholder,
}: {
  option: ComboboxOption | undefined;
  placeholder: string;
}) {
  return (
    <>
      <span className="flex items-center gap-1.5 truncate">
        {option !== undefined ? (
          <>
            <OptionAvatar option={option} />
            {option.label}
          </>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </span>
      <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );
}

export function ComboboxOptionLabel({
  option,
  selected,
}: {
  option: ComboboxOption;
  selected: boolean;
}) {
  return (
    <>
      <OptionAvatar option={option} />
      {option.label}
      {selected && <Check aria-hidden="true" className="ms-auto h-4 w-4" />}
    </>
  );
}

function OptionAvatar({ option }: { option: ComboboxOption }) {
  if (option.avatarName === undefined) return null;
  return <Avatar name={option.avatarName} src={option.avatarUrl} className="h-5 w-5 text-[10px]" />;
}
