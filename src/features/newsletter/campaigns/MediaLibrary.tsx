"use client";

import { FileImage } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useRef, useState } from "react";
import { useWorkspaceShell } from "@/components/shell/WorkspaceShellProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useCampaignMessages } from "./messages";
import { type MediaItem, type Page, safeNewsletterLink } from "./model";
import {
  CampaignHeading,
  DeleteConfirmation,
  Field,
  Pager,
  panelClass,
  QueryState,
  WriteMessage,
} from "./ui";

const fileLimit = 2 * 1024 * 1024;
const imageTypes = ["image/png", "image/jpeg", "image/gif"];

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("File read failed")));
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("File read failed"));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    });
    reader.readAsDataURL(file);
  });
}

export function MediaLibrary() {
  const m = useCampaignMessages();
  const { campaignCapabilities } = useWorkspaceShell();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const query = useNewsletterRead<Page<MediaItem>>("media.list", { search, page });
  const write = useNewsletterWrite();
  const rows = query.data?.results ?? [];

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || write.isPending || uploadInFlight.current) return;
    setNotice("");
    if (file.size === 0 || file.size > fileLimit || !imageTypes.includes(file.type)) {
      setLocalError(m.sizeError);
      return;
    }
    setLocalError("");
    uploadInFlight.current = true;
    setUploading(true);
    try {
      const base64 = await readBase64(file);
      await write.run("media.upload", { name: file.name, contentType: file.type, base64 });
      if (input.current) input.current.value = "";
      setFile(null);
      setNotice(m.saved);
      setSearch("");
      setText("");
      setPage(1);
    } catch {
      setLocalError(m.writeError);
    } finally {
      setUploading(false);
      uploadInFlight.current = false;
    }
  }

  function remove() {
    if (target === null || write.isPending) return;
    setLocalError("");
    setNotice("");
    void write
      .run("media.delete", { id: target, confirmed: true })
      .then(() => setNotice(m.saved))
      .catch(() => undefined);
  }

  function copy(url: string) {
    setLocalError("");
    setNotice("");
    void navigator.clipboard
      .writeText(url)
      .then(() => setNotice(m.copied))
      .catch(() => setLocalError(m.writeError));
  }

  return (
    <section className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-6">
      <CampaignHeading title={m.media} />
      {campaignCapabilities.edit && (
        <form
          className={`${panelClass} grid items-end gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]`}
          onSubmit={(event) => {
            void upload(event);
          }}
        >
          <div className="grid max-w-xl gap-1.5">
            <Field label={m.file} htmlFor="campaign-media-upload">
              <Input
                ref={input}
                id="campaign-media-upload"
                type="file"
                accept={imageTypes.join(",")}
                aria-describedby="campaign-media-size"
                disabled={uploading || write.isPending}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <p id="campaign-media-size" className="text-xs text-muted-foreground">
              {m.uploadHelp}
            </p>
          </div>
          <Button
            type="submit"
            className="w-fit self-start sm:self-center"
            disabled={!file || uploading || write.isPending}
          >
            {m.upload}
          </Button>
        </form>
      )}
      <WriteMessage error={write.error} success={notice} />
      {localError && (
        <p role="alert" className="text-sm text-destructive">
          {localError}
        </p>
      )}
      <div className={panelClass}>
        <form
          className="flex flex-wrap items-center gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(text.trim());
          }}
        >
          <Input
            className="max-w-xs"
            aria-label={m.searchMedia}
            placeholder={m.searchMedia}
            value={text}
            maxLength={200}
            onChange={(event) => setText(event.target.value)}
          />
          <Button size="sm" variant="outline" type="submit">
            {m.search}
          </Button>
        </form>
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
          empty={rows.length === 0 ? m.noMedia : undefined}
        >
          <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((item) => {
              const url = safeNewsletterLink(item.url);
              const thumb = item.thumb_url != null ? safeNewsletterLink(item.thumb_url) : null;
              return (
                <li className="overflow-hidden rounded-md border" key={item.id}>
                  <div className="relative flex h-36 items-center justify-center bg-muted/35">
                    {thumb !== null && imageTypes.includes(item.content_type) ? (
                      <Image
                        src={thumb}
                        alt=""
                        fill
                        unoptimized
                        sizes="240px"
                        referrerPolicy="no-referrer"
                        className="object-contain"
                      />
                    ) : (
                      <FileImage aria-hidden="true" className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="grid gap-2 p-3">
                    <p className="break-all text-sm font-medium">
                      <bdi>{item.filename}</bdi>
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {url !== null && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 text-sm font-medium text-link hover:underline"
                        >
                          {m.openMedia}
                        </a>
                      )}
                      {url !== null && (
                        <Button variant="ghost" size="sm" onClick={() => copy(url)}>
                          {m.copyUrl}
                        </Button>
                      )}
                      {campaignCapabilities.operate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={write.isPending}
                          onClick={() => setTarget(item.id)}
                        >
                          {m.delete}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </QueryState>
        <Pager
          page={page}
          perPage={query.data?.per_page ?? 25}
          total={query.data?.total ?? 0}
          onChange={setPage}
        />
      </div>
      <DeleteConfirmation
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={remove}
        pending={write.isPending}
      />
    </section>
  );
}
