"use client";
import { Check, Copy, ExternalLink, Pencil, Video, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { useActivitiesMessages } from "./useActivitiesMessages";

function safeMeetingLink(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}
function providerName(url: URL): string {
  if (url.hostname === "meet.google.com") return "Google Meet";
  if (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) return "Zoom";
  if (url.hostname === "teams.microsoft.com" || url.hostname === "teams.live.com")
    return "Microsoft Teams";
  return url.hostname;
}

export function CalendarMeetingField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const parsed = safeMeetingLink(value);
  function chooseOpen(next: boolean): void {
    if (next) {
      setInput(value);
      setInvalid(false);
      setCopyState("idle");
    }
    setOpen(next);
  }
  function apply(): void {
    const next = input.trim();
    if (next !== "" && safeMeetingLink(next) === null) {
      setInvalid(true);
      return;
    }
    onChange(next);
    setOpen(false);
  }
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  const picker = (
    <Popover modal open={open} onOpenChange={chooseOpen}>
      <Tip label={t("editor.editMeetingLink")}>
        <PopoverTrigger asChild>
          {parsed === null ? (
            <Button
              variant="ghost"
              className="w-full justify-start px-0 font-normal text-muted-foreground"
            >
              <Video className="me-2 size-4" aria-hidden />
              {t(value === "" ? "editor.addVideoMeeting" : "editor.editMeetingLink")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" aria-label={t("editor.editMeetingLink")}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
          )}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        data-calendar-link-editor
        aria-label={t("editor.meetingLink")}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-4 p-4"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }
        }}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("editor.meetingLink")}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("editor.meetingLinkHint")}
          </p>
        </div>
        <Input
          aria-label={t("editor.meetingLink")}
          aria-invalid={invalid || undefined}
          dir="ltr"
          value={input}
          maxLength={2048}
          className={MASK_CLASS}
          onChange={(event) => {
            setInput(event.target.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <p role="alert" className="text-xs text-destructive">
            {t("editor.invalidMeetingUrl")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {S.cancel}
          </Button>
          <Button size="sm" onClick={apply}>
            {t("editor.applyLink")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
  if (parsed === null)
    return (
      <div>
        {picker}
        {value !== "" && (
          <p className="text-xs text-destructive">{t("editor.invalidMeetingUrl")}</p>
        )}
      </div>
    );
  return (
    <div className={`space-y-1 ${MASK_CLASS}`}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:flex-nowrap">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/50 bg-card">
          <Video className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <p className="max-w-full truncate text-sm font-medium">
            <bdi>{providerName(parsed)}</bdi>
          </p>
          <p className="max-w-full truncate text-xs text-muted-foreground" dir="ltr">
            {parsed.hostname}
            {parsed.pathname}
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-0.5 border-t border-border/60 pt-1 sm:w-auto sm:border-0 sm:pt-0">
          <Tip label={t("editor.joinMeeting")}>
            <a
              href={parsed.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("editor.joinMeeting")}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Tip>
          <Tip label={t("editor.copyMeetingLink")}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("editor.copyMeetingLink")}
              onClick={() => {
                void copy();
              }}
            >
              {copyState === "copied" ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </Button>
          </Tip>
          {picker}
          <Tip label={t("editor.removeMeetingLink")}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("editor.removeMeetingLink")}
              onClick={() => {
                onChange("");
                setCopyState("idle");
              }}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          </Tip>
        </div>
      </div>
      {copyState !== "idle" && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(copyState === "copied" ? "editor.linkCopied" : "editor.copyFailed")}
        </p>
      )}
    </div>
  );
}
