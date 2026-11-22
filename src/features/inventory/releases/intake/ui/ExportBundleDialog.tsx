"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatNumber } from "@/lib/localeFormatting";
import { manufacturingReleaseMessages } from "../../ui/manufacturingReleaseMessages";
import {
  type ExportIntakeBinding,
  type ExportIntakeIssue,
  type ExportIntakeKind,
  type ExportManifest,
  exportManifestMaxBytes,
} from "../contracts";
import { parseExportManifest, validateExportBundle } from "../manifest";
import { type IntakeWords, intakeMessages } from "./messages";

export type VerifiedExportBundle = { manifest: ExportManifest; files: File[] };
type Validation =
  | { state: "checking" }
  | { state: "verified"; bundle: VerifiedExportBundle }
  | { state: "invalid"; issues: ExportIntakeIssue[] };

export function useIntakeKindLabels(): Record<ExportIntakeKind, string> {
  const { locale } = useLocalePreferences();
  return {
    ...manufacturingReleaseMessages[locale].kinds,
    pcbSource: intakeMessages[locale].pcbSource,
  };
}

export function IntakeIssues({
  issues,
  words: t,
}: {
  issues: ExportIntakeIssue[];
  words: IntakeWords;
}) {
  const unique = new Map(issues.map((issue) => [`${issue.code}:${issue.file ?? ""}`, issue]));
  return (
    <ul role="alert" className="space-y-1 text-sm text-destructive">
      {Array.from(unique, ([key, issue]) => (
        <li key={key} data-export-intake-issue={issue.code} className="wrap-anywhere">
          {issue.file !== undefined && (
            <>
              <bdi dir="auto">{issue.file}</bdi>
              {" · "}
            </>
          )}
          {t[issue.code]}
        </li>
      ))}
    </ul>
  );
}

function BundlePreview({ manifest, words: t }: { manifest: ExportManifest; words: IntakeWords }) {
  const preferences = useLocalePreferences();
  const kinds = useIntakeKindLabels();
  const title = useId();
  return (
    <section
      aria-labelledby={title}
      data-export-intake-preview
      className="min-w-0 space-y-2 rounded-md border p-3 text-sm"
    >
      <h3 id={title} className="font-semibold">
        {t.preview}
      </h3>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 wrap-anywhere">
          <dt className="text-xs text-muted-foreground">{t.exporter}</dt>
          <dd>
            <bdi dir="auto">
              {manifest.exporter.name} {manifest.exporter.version}
            </bdi>
          </dd>
        </div>
        <div className="min-w-0 wrap-anywhere">
          <dt className="text-xs text-muted-foreground">{t.sourceRevision}</dt>
          <dd>
            <bdi dir="auto">{manifest.exporter.sourceRevision}</bdi>
          </dd>
        </div>
      </dl>
      <ul aria-label={t.fileRoles} className="divide-y rounded-md border px-2">
        {manifest.files.map(({ name, kind, sizeBytes }) => (
          <li
            key={name}
            data-export-intake-preview-kind={kind}
            className="flex flex-wrap justify-between gap-x-2 py-1.5 wrap-anywhere"
          >
            <bdi dir="auto">{name}</bdi>
            <span className="text-xs text-muted-foreground">
              {kinds[kind]}
              {" · "}
              {formatNumber(sizeBytes, preferences, { style: "unit", unit: "byte" })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function checkBundle(
  manifestFile: File | null,
  target: ExportIntakeBinding,
  files: File[],
): Promise<Validation> {
  if (
    manifestFile === null ||
    manifestFile.name !== "manifest.json" ||
    manifestFile.size === 0 ||
    manifestFile.size > exportManifestMaxBytes
  ) {
    return { state: "invalid", issues: [{ code: "manifest" }] };
  }
  const manifest = parseExportManifest(await manifestFile.text(), target);
  if (!manifest.ok) return { state: "invalid", issues: manifest.issues };
  const bundle = await validateExportBundle(manifest.value, files);
  return bundle.ok
    ? { state: "verified", bundle: { manifest: bundle.value, files } }
    : { state: "invalid", issues: bundle.issues };
}

export function ExportBundleDialog({
  target,
  enabled,
  pending,
  close,
  restoreFocus,
  submit,
}: {
  target: ExportIntakeBinding;
  enabled: boolean;
  pending: boolean;
  close: () => void;
  restoreFocus: () => void;
  submit: (bundle: VerifiedExportBundle) => Promise<ExportIntakeIssue[]>;
}) {
  const t = intakeMessages[useLocalePreferences().locale];
  const manifestId = useId();
  const filesId = useId();
  const alive = useRef(false);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [writeIssues, setWriteIssues] = useState<ExportIntakeIssue[]>([]);
  const busy = pending || validation?.state === "checking";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function resetValidation() {
    setValidation(null);
    setWriteIssues([]);
  }

  async function validate() {
    setWriteIssues([]);
    setValidation({ state: "checking" });
    const result = await checkBundle(manifestFile, target, files).catch(
      (): Validation => ({ state: "invalid", issues: [{ code: "manifest" }] }),
    );
    if (alive.current) setValidation(result);
  }

  async function send() {
    if (!enabled || busy || validation?.state !== "verified") return;
    setWriteIssues([]);
    const issues = await submit(validation.bundle);
    if (alive.current) setWriteIssues(issues);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        data-export-intake-dialog
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl`}
        aria-busy={busy}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.open}</DialogTitle>
          <DialogDescription>{t.describe}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <dl className="grid grid-cols-2 gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0 wrap-anywhere">
              <dt className="text-xs text-muted-foreground">{t.sku}</dt>
              <dd>
                <bdi dir="auto">{target.sku}</bdi>
              </dd>
            </div>
            <div className="min-w-0 wrap-anywhere">
              <dt className="text-xs text-muted-foreground">{t.revision}</dt>
              <dd data-export-intake-revision={target.revision}>
                <bdi dir="auto">{target.revision}</bdi>
              </dd>
            </div>
          </dl>
          <div className="grid min-w-0 gap-1.5">
            <label className="text-sm font-medium" htmlFor={manifestId}>
              {t.manifestFile}
            </label>
            <Input
              id={manifestId}
              type="file"
              accept=".json,application/json"
              aria-describedby={`${manifestId}-hint`}
              data-export-intake-manifest
              disabled={busy}
              onChange={(event) => {
                setManifestFile(event.currentTarget.files?.[0] ?? null);
                resetValidation();
              }}
            />
            <p id={`${manifestId}-hint`} className="text-xs text-muted-foreground">
              {t.manifestHint}
            </p>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <label className="text-sm font-medium" htmlFor={filesId}>
              {t.bundleFiles}
            </label>
            <Input
              id={filesId}
              type="file"
              multiple
              data-export-intake-files
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.currentTarget.files ?? []));
                resetValidation();
              }}
            />
          </div>
          {validation?.state === "checking" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t.validating}
            </p>
          )}
          {validation?.state === "invalid" && <IntakeIssues issues={validation.issues} words={t} />}
          {validation?.state === "verified" && (
            <BundlePreview manifest={validation.bundle.manifest} words={t} />
          )}
          {writeIssues.length > 0 && <IntakeIssues issues={writeIssues} words={t} />}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-export-intake-validate
              disabled={busy}
              onClick={() => void validate()}
            >
              {t.validate}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-export-intake-submit
              disabled={busy || !enabled || validation?.state !== "verified"}
            >
              {t.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
