import { CalendarDays, ChartNoAxesCombined, Copy, Mail } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

const workflows = [
  {
    id: "meeting",
    title: "meetingTitle",
    prompt: "meetingPrompt",
    access: "meetingAccess",
    icon: CalendarDays,
  },
  {
    id: "pipeline",
    title: "pipelineTitle",
    prompt: "pipelinePrompt",
    access: "pipelineAccess",
    icon: ChartNoAxesCombined,
  },
  { id: "draft", title: "draftTitle", prompt: "draftPrompt", access: "draftAccess", icon: Mail },
] as const;

export function McpWorkflowExamples({ compact }: { compact: boolean }) {
  const t = useAppTranslations("integrations");
  const titleId = useId();
  const [selected, setSelected] = useState<(typeof workflows)[number]>(workflows[0]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(t(selected.prompt));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("tryWorkflow")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("workflowBody")}</p>
      </div>
      <div className={cn("grid gap-2", !compact && "sm:grid-cols-3")}>
        {workflows.map((workflow) => (
          <Button
            key={workflow.id}
            type="button"
            variant="ghost"
            aria-label={t(workflow.title)}
            aria-pressed={selected.id === workflow.id}
            onClick={() => {
              setSelected(workflow);
              setCopyState("idle");
            }}
            className={cn(
              "h-auto min-h-12 justify-start gap-2.5 rounded-lg border px-3 py-3 text-start text-xs",
              selected.id === workflow.id
                ? "border-primary/35 bg-primary/5 text-primary"
                : "border-border/60 text-muted-foreground",
            )}
          >
            <workflow.icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-normal">{t(workflow.title)}</span>
          </Button>
        ))}
      </div>
      <section aria-labelledby={titleId} className="rounded-xl bg-muted/35 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id={titleId} className="text-xs font-semibold">
            {t("promptPreview")}
          </h4>
          <Button
            type="button"
            variant="ghost"
            className="-me-2 h-auto min-h-9 px-2 text-xs"
            onClick={() => {
              void copy();
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {t("copyPrompt")}
          </Button>
        </div>
        <blockquote className="mt-2 text-sm leading-relaxed">{t(selected.prompt)}</blockquote>
        <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          {t(selected.access)}
        </p>
        {copyState !== "idle" && (
          <p
            role={copyState === "copied" ? "status" : "alert"}
            className="mt-3 text-xs text-muted-foreground"
          >
            {t(copyState === "copied" ? "promptCopied" : "copyFailed")}
          </p>
        )}
      </section>
    </section>
  );
}
