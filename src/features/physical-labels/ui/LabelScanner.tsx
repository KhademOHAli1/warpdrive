"use client";

import { ArrowUpRight, Camera, ScanLine, Square } from "lucide-react";
import { type RefObject, type SubmitEvent, useEffect, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { runCamera } from "../cameraSession";
import type { LabelRecord, ScanInput, ScanResult } from "../contracts";
import { labelMessages } from "./labelMessages";
import { scannerMessages } from "./scannerMessages";

type Lookup = ScanResult | { ok: false; error: "transport" };
type Props = {
  initialCode?: string;
  resolve: (input: ScanInput) => Promise<ScanResult>;
  registryVisible: boolean;
  fixture?: boolean;
};

async function lookup(resolve: Props["resolve"], input: ScanInput): Promise<Lookup> {
  try {
    return await resolve(input);
  } catch {
    return { ok: false, error: "transport" };
  }
}

const cameraDurationMs = 120_000;

function useCamera(video: RefObject<HTMLVideoElement | null>, onScan: (input: ScanInput) => void) {
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<"cameraError" | "cameraTimeout" | null>(null);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const release = () => active.current?.abort();
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, []);

  function stop() {
    active.current?.abort();
  }

  function start() {
    if (active.current !== null || video.current === null) return;
    const controller = new AbortController();
    const element = video.current;
    active.current = controller;
    setNotice(null);
    setRunning(true);

    const timer = window.setTimeout(() => {
      setNotice("cameraTimeout");
      controller.abort();
    }, cameraDurationMs);
    controller.signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        active.current = null;
        setRunning(false);
      },
      { once: true },
    );

    void runCamera(element, controller.signal, (scan) => {
      controller.abort();
      onScan(scan);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setNotice("cameraError");
      controller.abort();
    });
  }

  return { running, notice, stop, start };
}

function ScanMatch({ label }: { label: LabelRecord }) {
  const locale = useLocale();
  const target = label.target;
  return (
    <div
      role="status"
      data-label-target={target.id}
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"
    >
      <div className="min-w-0">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {labelMessages[locale][target.kind]}
        </div>
        <h2 className="break-words font-semibold">
          <bdi>{target.title}</bdi>
        </h2>
        {target.subtitle === null ? null : (
          <p className="break-words text-sm text-muted-foreground">
            <bdi>{target.subtitle}</bdi>
          </p>
        )}
      </div>
      {target.href === null ? null : (
        <a href={target.href} className={buttonVariants({ variant: "outline" })}>
          {scannerMessages[locale].open}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
      )}
    </div>
  );
}

export function LabelScanner({ initialCode, resolve, registryVisible, fixture }: Props) {
  const words = scannerMessages[useLocale()];
  const codeId = useId();
  const [value, setValue] = useState(initialCode ?? "");
  const [pending, setPending] = useState(initialCode !== undefined);
  const [result, setResult] = useState<Lookup | null>(null);
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (initialCode === undefined) return;
    const current = ++request.current;
    void lookup(resolve, { value: initialCode }).then((found) => {
      if (current !== request.current) return;
      setResult(found);
      setPending(false);
    });
    return () => {
      request.current += 1;
    };
  }, [initialCode, resolve]);

  function runLookup(scan: ScanInput) {
    const current = ++request.current;
    setValue("");
    setResult(null);
    setPending(true);
    void lookup(resolve, scan).then((found) => {
      if (current !== request.current) return;
      setResult(found);
      setPending(false);
      input.current?.focus();
    });
  }
  const camera = useCamera(video, runLookup);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.length === 0) return;
    camera.stop();
    runLookup({ value });
  }

  return (
    <main className={`${BLOCK_CLASS} ph-no-capture mx-auto w-full max-w-2xl px-4 py-8 sm:px-6`}>
      <PageHeading
        title={words.title}
        description={words.instructions}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {fixture === true ? <Badge variant="outline">{words.demo}</Badge> : null}
            {registryVisible ? (
              <a
                href="/operations/labels"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {words.registry}
              </a>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4">
        <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
          <form onSubmit={submit}>
            <label htmlFor={codeId} className="mb-1.5 block text-sm font-medium">
              {words.code}
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Input
                ref={input}
                id={codeId}
                dir="ltr"
                className="h-9 min-w-0 flex-1"
                maxLength={4096}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <Button type="submit" disabled={pending || value.length === 0}>
                <ScanLine aria-hidden="true" className="size-4" />
                {words.lookup}
              </Button>
            </div>
          </form>

          {camera.running ? (
            <Button variant="outline" onClick={camera.stop}>
              <Square aria-hidden="true" className="size-4" />
              {words.cameraOff}
            </Button>
          ) : (
            <Button variant="outline" onClick={camera.start} disabled={pending}>
              <Camera aria-hidden="true" className="size-4" />
              {words.cameraOn}
            </Button>
          )}
          <video
            ref={video}
            aria-label={words.preview}
            hidden={!camera.running}
            className="aspect-video w-full rounded-md bg-black object-contain"
            playsInline
            muted
          />
          {camera.notice === null ? null : (
            <p className="text-sm text-muted-foreground" role="status">
              {words[camera.notice]}
            </p>
          )}
        </div>

        <div aria-live="polite" aria-busy={pending}>
          {result?.ok === true ? <ScanMatch label={result.label} /> : null}
          {result?.ok === false ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {words[result.error]}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
