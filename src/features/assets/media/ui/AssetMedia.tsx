"use client";

import { Download, Eye, ImagePlus, Paperclip } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentIcon } from "@/features/files/AttachmentIcon";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import { cn } from "@/lib/utils";
import { type AssetMediaFile, assetMediaDocumentType, assetMediaPhotoTypes } from "../contracts";
import { assetMediaUploadMetadata } from "../fileRules";
import { type AssetMediaWords, assetMediaMessages } from "./messages";
import type { AssetMediaController } from "./useAssetMedia";

function safeHref(raw: string | null) {
  if (raw === null || typeof window === "undefined" || /[\\\p{Cc}]/u.test(raw)) return null;
  try {
    const { origin } = window.location;
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    if (raw.startsWith("blob:")) return raw;
    if (raw.startsWith("/api/assets/media/") && url.pathname.startsWith("/api/assets/media/"))
      return raw;
  } catch {
    return null;
  }
  return null;
}

export function AssetMediaCover({ state }: { state: AssetMediaController }) {
  const { locale } = useLocalePreferences();
  const t = assetMediaMessages[locale];
  const data = state.workspace;
  const selected = data?.files.find(({ id, kind }) => id === data.coverId && kind === "photo");
  const file = selected ?? data?.inheritedCover;
  if (file === null || file === undefined) return null;
  const href = safeHref(file.previewHref);
  if (href === null) return null;
  const isModel = selected === undefined || data?.target.type === "model";
  const label = isModel ? t.modelPhoto : t.ownPhoto;
  return (
    <figure
      data-asset-media-cover={isModel ? "model" : "own"}
      className="w-full min-w-0 max-w-52 space-y-1"
    >
      <a
        aria-label={`${t.preview} ${file.name}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="relative block aspect-4/3 w-full rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Image
          src={href}
          alt={file.name}
          fill
          unoptimized
          sizes="208px"
          className="object-contain"
        />
      </a>
      <figcaption className="wrap-anywhere text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function MediaTime({ value }: { value: string }) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  return (
    <time dateTime={value}>
      {hydrated ? formatDateTime(value, preferences) : value.slice(0, 10)}
    </time>
  );
}

function MediaFile({
  file,
  current,
  canSelectCover,
  model,
  busy,
  setCover,
  words: t,
}: {
  file: AssetMediaFile;
  current: boolean;
  canSelectCover: boolean;
  model: boolean;
  busy: boolean;
  setCover: (id: string) => Promise<boolean>;
  words: AssetMediaWords;
}) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const preview = safeHref(file.previewHref);
  const download = safeHref(file.downloadHref);
  const button = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <li
      data-asset-media-file={file.id}
      data-asset-media-file-kind={file.kind}
      tabIndex={-1}
      className="min-w-0 space-y-1.5 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <AttachmentIcon filename={file.name} />
          <bdi dir="auto" className="min-w-0 wrap-anywhere font-medium">
            {file.name}
          </bdi>
        </div>
        {current && <Badge variant="secondary">{t.currentCover}</Badge>}
      </div>
      <p className="min-w-0 wrap-anywhere text-xs text-muted-foreground">
        {t[file.kind]} ·{" "}
        {hydrated
          ? formatNumber(file.sizeBytes, preferences, { style: "unit", unit: "byte" })
          : file.sizeBytes}{" "}
        · <bdi dir="auto">{file.uploadedBy}</bdi> · <MediaTime value={file.uploadedAt} />
      </p>
      <div className="flex flex-wrap gap-1.5">
        {preview !== null && (
          <a
            data-asset-media-preview
            href={preview}
            target="_blank"
            rel="noreferrer"
            aria-label={`${t.preview} ${file.name}`}
            className={button}
          >
            <Eye aria-hidden="true" size={14} /> {t.preview}
          </a>
        )}
        {download !== null && (
          <a
            data-asset-media-download
            href={download}
            download={file.name}
            aria-label={`${t.download} ${file.name}`}
            className={button}
          >
            <Download aria-hidden="true" size={14} /> {t.download}
          </a>
        )}
        {canSelectCover && file.kind === "photo" && !current && (
          <Button
            size="sm"
            variant="ghost"
            data-asset-media-set-cover
            disabled={busy}
            onClick={(event) => {
              const row = event.currentTarget.closest("li");
              void setCover(file.id).then((changed) => {
                if (changed && row?.isConnected === true) row.focus();
              });
            }}
          >
            {model ? t.useModelCover : t.usePhoto}
          </Button>
        )}
      </div>
    </li>
  );
}

function UploadMediaDialog({
  kind,
  state,
  busy,
  close,
  restoreFocus,
  words: t,
}: {
  kind: AssetMediaFile["kind"];
  state: AssetMediaController;
  busy: boolean;
  close: () => void;
  restoreFocus: () => void;
  words: AssetMediaWords;
}) {
  const [attachment, setAttachment] = useState<{ file: File; preview: string | null } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const photo = kind === "photo";
  const accept = photo ? assetMediaPhotoTypes.join(",") : assetMediaDocumentType;
  useEffect(
    () => () => {
      if (attachment?.preview != null) URL.revokeObjectURL(attachment.preview);
    },
    [attachment],
  );
  const title = photo ? t.addPhoto : t.addDocument;
  async function save() {
    if (attachment !== null && (await state.upload(kind, attachment.file))) close();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        data-asset-media-dialog={kind}
        className={cn(
          BLOCK_CLASS,
          "ph-no-capture max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md",
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{photo ? t.photoHelp : t.documentHelp}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <SalesInput
            data-asset-media-input={kind}
            type="file"
            label={photo ? t.photoInput : t.documentInput}
            accept={accept}
            disabled={busy}
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              const target = state.workspace?.target;
              const valid =
                picked !== undefined &&
                target !== undefined &&
                assetMediaUploadMetadata({
                  target,
                  kind,
                  name: picked.name,
                  mime: picked.type,
                  sizeBytes: picked.size,
                }) !== null;
              state.clearStatus();
              setInvalid(picked !== undefined && !valid);
              setAttachment(
                valid
                  ? { file: picked, preview: photo ? URL.createObjectURL(picked) : null }
                  : null,
              );
            }}
          />
          {attachment?.preview != null && (
            <div
              className="relative h-40 rounded-md border bg-muted"
              data-asset-media-staged-preview
            >
              <Image
                src={attachment.preview}
                alt={attachment.file.name}
                fill
                unoptimized
                sizes="320px"
                className="object-contain"
              />
            </div>
          )}
          {(invalid || state.error !== null) && (
            <p role="alert" className="text-sm text-destructive">
              {invalid ? t.invalid : state.error === null ? null : t[state.error]}
            </p>
          )}
          <DialogFooter>
            {state.error === "conflict" && (
              <Button type="button" variant="ghost" disabled={busy} onClick={state.reload}>
                {t.retry}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              {t.cancel}
            </Button>
            <Button
              type="submit"
              disabled={busy || attachment === null || state.workspace?.canManage !== true}
            >
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MediaHistory({
  data,
  words: t,
}: {
  data: NonNullable<AssetMediaController["workspace"]>;
  words: AssetMediaWords;
}) {
  if (data.history.length === 0) return null;
  const names = new Map(data.files.map(({ id, name }) => [id, name]));
  return (
    <div className="space-y-1.5" data-asset-media-history>
      <h4 className="font-medium">{t.history}</h4>
      <ol className="divide-y rounded-md border">
        {[...data.history]
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((event) => (
            <li
              key={event.id}
              data-asset-media-event={event.type}
              className="space-y-0.5 p-2.5 text-xs"
            >
              <p className="wrap-anywhere">
                {event.type === "cover_changed" && event.fileId === null
                  ? t.cleared
                  : t[event.type]}
                {event.fileId !== null && (
                  <>
                    {" · "}
                    <bdi dir="auto">{names.get(event.fileId)}</bdi>
                  </>
                )}
              </p>
              <p className="wrap-anywhere text-muted-foreground">
                <bdi dir="auto">{event.actor}</bdi> · <MediaTime value={event.at} />
              </p>
            </li>
          ))}
      </ol>
    </div>
  );
}

export function AssetMediaPanel({
  state,
  canManage,
  busy = false,
  className,
}: {
  state: AssetMediaController;
  canManage: boolean;
  busy?: boolean;
  className?: string;
}) {
  const { locale } = useLocalePreferences();
  const t = assetMediaMessages[locale];
  const [upload, setUpload] = useState<AssetMediaFile["kind"] | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  if (upload !== null && (!canManage || state.readError === "unavailable")) setUpload(null);
  if (!state.available) return null;
  const data = state.workspace;
  const model = data?.target.type === "model";
  const editable = canManage && data?.canManage === true;
  const waiting = busy || state.pending;
  const close = () => setUpload(null);
  const kinds = model ? (["photo"] as const) : (["photo", "document"] as const);
  return (
    <section data-asset-media className={cn("min-w-0 space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 ref={heading} tabIndex={-1} className="font-semibold">
          {t.heading}
        </h3>
        {editable && (
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => {
              const photo = kind === "photo";
              const Icon = photo ? ImagePlus : Paperclip;
              return (
                <Button
                  key={kind}
                  size="sm"
                  variant="outline"
                  data-asset-media-add={kind}
                  disabled={waiting}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    state.clearStatus();
                    setUpload(kind);
                  }}
                >
                  <Icon aria-hidden="true" size={14} /> {photo ? t.addPhoto : t.addDocument}
                </Button>
              );
            })}
          </div>
        )}
      </div>
      {state.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {state.readError !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t[state.readError]}
          </p>
          <Button size="sm" variant="ghost" disabled={waiting} onClick={state.reload}>
            {t.retry}
          </Button>
        </div>
      )}
      {upload === null && state.error !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t[state.error]}
          </p>
          {state.error === "conflict" && (
            <Button size="sm" variant="ghost" disabled={waiting} onClick={state.reload}>
              {t.retry}
            </Button>
          )}
        </div>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      {data !== null && (
        <>
          {editable && data.coverId !== null && (
            <Button
              size="sm"
              variant="ghost"
              data-asset-media-clear-cover
              disabled={waiting}
              onClick={() =>
                void state.setCover(null).then((changed) => {
                  if (changed) heading.current?.focus();
                })
              }
            >
              {model
                ? t.clearModelCover
                : data.inheritedCover === null
                  ? t.clearPhoto
                  : t.useModelPhoto}
            </Button>
          )}
          {data.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noFiles}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {[...data.files]
                .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
                .map((file) => (
                  <MediaFile
                    key={file.id}
                    file={file}
                    current={data.coverId === file.id}
                    canSelectCover={editable}
                    model={model}
                    busy={waiting}
                    setCover={state.setCover}
                    words={t}
                  />
                ))}
            </ul>
          )}
          <MediaHistory data={data} words={t} />
        </>
      )}
      {upload !== null && canManage && (
        <UploadMediaDialog
          kind={upload}
          state={state}
          busy={waiting}
          close={close}
          restoreFocus={() =>
            (trigger.current?.isConnected === true ? trigger.current : heading.current)?.focus()
          }
          words={t}
        />
      )}
    </section>
  );
}
