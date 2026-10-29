"use client";
import {
  ALargeSmall,
  Bold,
  Image as ImageIcon,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Tip } from "@/components/ui/tooltip";
import type { EmailMessages } from "@/features/email/emailMessages";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useFormatters } from "@/lib/useFormatters";

const COMPACT_TRIGGER_CLASSNAME =
  "h-10 w-auto justify-start gap-0.5 rounded-md border-0 bg-transparent px-2 py-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground";
const TOOL_BUTTON_CLASSNAME =
  "size-10 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground";
function localizedFONT_FAMILY_OPTIONS(E: EmailMessages): SelectOption[] {
  return [
    { label: E._extra.default, value: "" },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "Georgia", value: "Georgia, serif" },
    { label: "Courier New", value: "'Courier New', monospace" },
    { label: "Times New Roman", value: "'Times New Roman', serif" },
    { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  ];
}
function localizedFONT_SIZE_OPTIONS(
  E: EmailMessages,
  formatNumber: (n: number) => string,
): SelectOption[] {
  return [
    { label: E._extra.default, value: "" },
    ...[10, 12, 14, 16, 18, 24, 32].map((size) => ({
      label: formatNumber(size),
      value: `${size}px`,
    })),
  ];
}

export interface FormatToolbarActions {
  undo: () => void;
  redo: () => void;
  bold: () => void;
  italic: () => void;
  underline: () => void;
  strike: () => void;
  bulletList: () => void;
  orderedList: () => void;
  outdent: () => void;
  indent: () => void;
  blockquote: () => void;
  link: () => void;
  image: () => void;
  clearFormat: () => void;
}

interface FormatToolbarControlsProps {
  fontFamily: string;
  fontSize: string;
  textColor: string;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
  actions: FormatToolbarActions;
}

function Divider(): React.ReactNode {
  return <span aria-hidden="true" className="mx-1 inline-block w-px self-stretch bg-border/60" />;
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}): React.ReactNode {
  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={onClick}
        className={TOOL_BUTTON_CLASSNAME}
      >
        <Icon aria-hidden="true" className="size-4" />
      </Button>
    </Tip>
  );
}

export function FormatToolbarControls({
  fontFamily,
  fontSize,
  textColor,
  onFontFamilyChange,
  onFontSizeChange,
  onTextColorChange,
  actions,
}: FormatToolbarControlsProps): React.ReactNode {
  const E = useEmailMessages();
  const format = useFormatters();

  return (
    <div
      role="toolbar"
      aria-label={E._extra.text_formatting}
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      <ToolButton label={E._extra.undo} icon={Undo2} onClick={actions.undo} />
      <ToolButton label={E._extra.redo} icon={Redo2} onClick={actions.redo} />
      <Divider />
      <Select
        ariaLabel={E._extra.font_family}
        triggerContent={<Type aria-hidden="true" className="size-4" />}
        triggerClassName={COMPACT_TRIGGER_CLASSNAME}
        value={fontFamily}
        onChange={onFontFamilyChange}
        options={localizedFONT_FAMILY_OPTIONS(E)}
      />
      <Select
        ariaLabel={E._extra.font_size}
        triggerContent={<ALargeSmall aria-hidden="true" className="size-4" />}
        triggerClassName={COMPACT_TRIGGER_CLASSNAME}
        value={fontSize}
        onChange={onFontSizeChange}
        options={localizedFONT_SIZE_OPTIONS(E, format.number)}
      />
      <ColorPicker
        value={textColor}
        onChange={onTextColorChange}
        ariaLabel={E._extra.text_color}
        triggerClassName={TOOL_BUTTON_CLASSNAME}
      />
      <Divider />
      <ToolButton label={E._extra.bold} icon={Bold} onClick={actions.bold} />
      <ToolButton label={E._extra.italic} icon={Italic} onClick={actions.italic} />
      <ToolButton label={E._extra.underline} icon={Underline} onClick={actions.underline} />
      <ToolButton label={E._extra.strikethrough} icon={Strikethrough} onClick={actions.strike} />
      <Divider />
      <ToolButton label={E._extra.bulleted_list} icon={List} onClick={actions.bulletList} />
      <ToolButton label={E._extra.ordered_list} icon={ListOrdered} onClick={actions.orderedList} />
      <ToolButton label={E._extra.outdent} icon={Outdent} onClick={actions.outdent} />
      <ToolButton label={E._extra.indent} icon={Indent} onClick={actions.indent} />
      <ToolButton label={E._extra.blockquote} icon={Quote} onClick={actions.blockquote} />
      <Divider />
      <ToolButton label={E._extra.link} icon={LinkIcon} onClick={actions.link} />
      <ToolButton label={E._extra.image} icon={ImageIcon} onClick={actions.image} />
      <Divider />
      <ToolButton
        label={E._extra.clear_format}
        icon={RemoveFormatting}
        onClick={actions.clearFormat}
      />
    </div>
  );
}
