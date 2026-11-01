"use client";
import { AlignLeft, Type } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RichTextBody } from "@/features/email/composer/RichTextBodyLazy";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { isBlankHtml } from "./isBlankHtml";

export function CalendarEventDescription({
  value,
  expanded,
  onChange,
}: {
  value: string;
  expanded: boolean;
  onChange: (value: string) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [open, setOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  if (!open && !expanded && isBlankHtml(value))
    return (
      <Button
        variant="ghost"
        className="w-full justify-start px-0 font-normal text-muted-foreground"
        onClick={() => {
          setOpen(true);
          setFormatting(true);
        }}
      >
        <AlignLeft className="me-2 size-4" aria-hidden />
        {t("editor.addDescription")}
      </Button>
    );
  return (
    <section aria-label={t("editor.description")} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-3 text-sm font-medium">
          <AlignLeft className="size-4 text-muted-foreground" aria-hidden />
          {t("editor.description")}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("editor.formatting")}
          aria-pressed={formatting}
          onClick={() => setFormatting(!formatting)}
        >
          <Type className="size-4" aria-hidden />
        </Button>
      </div>
      <div
        onFocusCapture={() => setFormatting(true)}
        className="rounded-lg border border-border/70 bg-background px-2 transition-colors focus-within:border-ring/60"
      >
        <RichTextBody
          ariaLabel={t("editor.description")}
          html={value}
          onChange={onChange}
          frameClassName={formatting ? "border-0" : "border-0 [&_[role=toolbar]]:hidden"}
          contentClassName="min-h-20 px-2 py-3 [&_.ProseMirror]:min-h-20"
        />
      </div>
    </section>
  );
}
