// FileAttachments: reusable list + upload UI for the files attached to one entity.
// Lists confirmed files (trpc files.listForEntity) with on-demand presigned
// download, and an upload control that runs the request -> POST -> confirm
// handshake then refetches. Reused by the deal Files tab, contact Files panel,
// and the compose Files dropzone.

"use client";

import { useRef, useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ALLOWED_CONTENT_TYPES } from "./contentTypes";
import type { FileEntityType, FileListItem } from "./listFilesForEntity";
import { requestDownloadAction } from "./serverActions";
import { uploadOneFile } from "./uploadHandshake";

interface FileAttachmentsProps {
  entityType: FileEntityType;
  entityId: string;
  // readOnly renders the list + download only, dropping the upload control. Used where
  // this panel is a view rather than a compose surface (e.g. the deal History > Files
  // filter), so the deal page does not show two identical uploaders.
  readOnly?: boolean;
}

export function FileAttachments({
  entityType,
  entityId,
  readOnly = false,
}: FileAttachmentsProps): React.ReactNode {
  const t = useAppTranslations("files");
  const locale = useLocale();
  const format = useFormatters();
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${format.number(bytes)} ${t("bytes")}`;
    if (bytes < 1024 * 1024) return `${format.number(Math.round(bytes / 1024))} ${t("kilobytes")}`;
    return `${format.number(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${t("megabytes")}`;
  }
  const query = trpc.files.listForEntity.useQuery({ entityType, entityId });
  const files: FileListItem[] = query.data ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(list: FileList | null): Promise<void> {
    if (list === null || list.length === 0) return;
    setError(null);
    setBusy(true);
    let anyConfirmed = false;
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (file === undefined) continue;
        const message = await uploadOneFile(file, entityType, entityId, locale);
        if (message !== null) {
          setError(message);
          return;
        }
        anyConfirmed = true;
      }
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
      // Refetch whenever at least one file was confirmed, INCLUDING a partial-batch failure,
      // so already-stored files appear instead of tempting the user into a duplicate re-upload.
      if (anyConfirmed) void query.refetch();
    }
  }

  async function handleDownload(fileId: string): Promise<void> {
    setError(null);
    try {
      const result = await requestDownloadAction(readCsrfToken(), fileId);
      if (!result.ok) {
        setError(t("downloadFailed"));
        return;
      }
      // Anchor click, not window.open: the URL is minted after an await, so the user gesture is
      // gone and window.open would be popup-blocked. A programmatic anchor click is not.
      const anchor = document.createElement("a");
      anchor.href = result.value.url;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.click();
    } catch {
      setError(t("downloadFailed"));
    }
  }

  return (
    <div>
      {error !== null && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {query.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("loadFailed")}
        </p>
      )}
      {files.length === 0 ? (
        !query.isLoading && !query.isError ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : null
      ) : (
        <ul className="space-y-1">
          {files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => void handleDownload(file.id)}
                aria-label={t("download", { name: file.filename })}
                className="truncate text-start text-primary hover:underline"
              >
                <bdi dir="auto">{file.filename}</bdi>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatBytes(file.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-md border px-3 py-1.5 text-sm transition-transform hover:bg-accent active:scale-[0.96] disabled:opacity-50"
          >
            {busy ? t("uploading") : t("upload")}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label={t("upload")}
            accept={ALLOWED_CONTENT_TYPES.join(",")}
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
