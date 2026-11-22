"use client";

import { ArrowUpRight, MapPin, Send } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type AssetTagContactInput,
  type AssetTagContactResult,
  type AssetTagCoordinates,
  type AssetTagScanInput,
  type AssetTagScanResult,
  type AssetTagTarget,
  assetTagContactInput,
  assetTagCoordinates,
} from "../contracts";
import { type AssetTagLandingWords, assetTagLandingMessages } from "./assetTagLandingMessages";

type ResolveTag = (input: AssetTagScanInput) => Promise<AssetTagScanResult>;
type ContactTag = (input: AssetTagContactInput) => Promise<AssetTagContactResult>;

export type AssetTagLandingProps = {
  token: string;
  signedIn: boolean;
  signInHref: string;
  contactAvailable: boolean;
  fixture?: boolean;
  resolve?: ResolveTag;
  sendMessage?: ContactTag;
};

function localPath(href: string | null) {
  if (href === null || !href.startsWith("/") || href.startsWith("//") || /[\\\p{Cc}]/u.test(href))
    return null;
  return href;
}

function usePageRequestRef() {
  const activeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = () => activeRef.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      window.removeEventListener("pagehide", abort);
      abort();
    };
  }, []);
  return activeRef;
}

type Lookup = AssetTagScanResult | { ok: false; error: "transport" };

async function lookup(
  token: string,
  resolve: ResolveTag,
  coordinates: AssetTagCoordinates | null,
): Promise<Lookup> {
  try {
    return await resolve({ identifier: token, source: "printed_link", coordinates });
  } catch {
    return { ok: false, error: "transport" };
  }
}

function useTagLookup(token: string, resolve: ResolveTag) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Lookup | null>(null);
  const job = useRef<{ attempt: number; promise: Promise<Lookup> } | null>(null);
  const requestRef = usePageRequestRef();

  useEffect(() => {
    const active = new AbortController();
    requestRef.current = active;
    const cached = job.current;
    const operation =
      cached?.attempt === attempt ? cached : { attempt, promise: lookup(token, resolve, null) };
    job.current = operation;
    void operation.promise.then((found) => {
      if (!active.signal.aborted) setResult(found);
    });
    return () => active.abort();
  }, [attempt, requestRef, resolve, token]);

  function retry() {
    setResult(null);
    setAttempt((previous) => previous + 1);
  }

  return { result, setResult, retry };
}

function acquireCoordinates(): Promise<AssetTagCoordinates | null> {
  return new Promise<AssetTagCoordinates | null>((finish) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const parsed = assetTagCoordinates.safeParse({
          longitude: coords.longitude,
          latitude: coords.latitude,
          accuracy: coords.accuracy,
        });
        finish(parsed.success ? parsed.data : null);
      },
      () => finish(null),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 12_000 },
    );
  }).catch(() => null);
}

type LocationState = "idle" | "locating" | "saving" | "saved" | "error";

function requestAborted(request: AbortController) {
  return request.signal.aborted;
}

function TagLocation({
  token,
  resolve,
  onResolved,
  words: t,
}: {
  token: string;
  resolve: ResolveTag;
  onResolved: (result: AssetTagScanResult) => void;
  words: AssetTagLandingWords;
}) {
  const [state, setState] = useState<LocationState>("idle");
  const activeRef = usePageRequestRef();
  const help = useId();
  const locating = state === "locating";
  const saving = state === "saving";
  const pending = locating || saving;

  async function share() {
    if (activeRef.current !== null) return;
    const current = new AbortController();
    activeRef.current = current;
    setState("locating");
    try {
      const coordinates = await acquireCoordinates();
      if (requestAborted(current)) return;
      if (coordinates === null) {
        setState("error");
        return;
      }
      setState("saving");
      const result = await lookup(token, resolve, coordinates);
      if (requestAborted(current)) return;
      setState(result.ok ? "saved" : "error");
      if (result.ok || result.error !== "transport") onResolved(result);
    } finally {
      if (activeRef.current === current) activeRef.current = null;
    }
  }

  function cancel() {
    activeRef.current?.abort();
    activeRef.current = null;
    setState("idle");
  }

  return (
    <section
      data-asset-tag-location
      aria-label={t.locationTitle}
      className="space-y-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h2 className="text-sm font-semibold">{t.locationTitle}</h2>
      <p id={help} className="text-sm text-muted-foreground">
        {t.locationHelp}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          aria-describedby={help}
          disabled={pending || state === "saved"}
          onClick={() => void share()}
        >
          <MapPin aria-hidden="true" className="size-4" />
          {t.shareLocation}
        </Button>
        {locating && (
          <Button type="button" variant="ghost" onClick={cancel}>
            {t.cancelLocation}
          </Button>
        )}
      </div>
      {pending || state === "saved" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {locating ? t.locating : saving ? t.savingLocation : t.locationSaved}
        </p>
      ) : null}
      {state === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {t.locationError}
        </p>
      )}
    </section>
  );
}

function TagTarget({ target, words: t }: { target: AssetTagTarget; words: AssetTagLandingWords }) {
  const href = localPath(target.href);
  return (
    <section
      data-asset-tag-target={target.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 sm:p-5"
      aria-label={t[target.kind]}
    >
      <div className="min-w-0 wrap-anywhere">
        <p className="text-xs font-medium text-muted-foreground">{t[target.kind]}</p>
        <h2 className="mt-1 text-base font-semibold">
          <bdi>{target.title}</bdi>
        </h2>
        {target.subtitle !== null && (
          <p className="mt-1 text-sm text-muted-foreground">
            <bdi>{target.subtitle}</bdi>
          </p>
        )}
      </div>
      {href !== null && (
        <a className={buttonVariants({ variant: "outline" })} href={href}>
          {t.open}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

function AuthorizedTag({
  token,
  resolve,
  words: t,
}: {
  token: string;
  resolve: ResolveTag;
  words: AssetTagLandingWords;
}) {
  const { result, setResult, retry } = useTagLookup(token, resolve);
  if (result === null)
    return (
      <p role="status" className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t.resolving}
      </p>
    );
  if (!result.ok) {
    const transport = result.error === "transport";
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
        <p role="status">{transport ? t.resolveError : t.unavailable}</p>
        {transport && (
          <Button type="button" variant="outline" onClick={retry}>
            {t.retry}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TagTarget target={result.target} words={t} />
      <TagLocation token={token} resolve={resolve} onResolved={setResult} words={t} />
    </div>
  );
}

type ContactState = "idle" | "pending" | "sent" | "invalid" | "unavailable" | "transport";

function TagMessage({
  token,
  send,
  words: t,
}: {
  token: string;
  send: ContactTag;
  words: AssetTagLandingWords;
}) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [state, setState] = useState<ContactState>("idle");
  const request = useRef<AssetTagContactInput | null>(null);
  const activeRef = usePageRequestRef();
  const id = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRef.current !== null || state === "sent") return;
    const trimmed = message.trim();
    const replyTo = reply.trim() || null;
    const current = new AbortController();
    activeRef.current = current;
    try {
      const previous = request.current;
      const entry = assetTagContactInput.safeParse({
        token,
        message: trimmed,
        replyTo,
        requestId:
          previous?.message === trimmed && previous.replyTo === replyTo
            ? previous.requestId
            : crypto.randomUUID(),
      });
      if (!entry.success) {
        setState("invalid");
        return;
      }
      request.current = entry.data;
      setState("pending");
      const result = await send(entry.data);
      if (current.signal.aborted) return;
      request.current = null;
      if (result.ok) {
        setMessage("");
        setReply("");
      }
      setState(result.ok ? "sent" : result.error);
    } catch {
      if (!current.signal.aborted) setState("transport");
    } finally {
      activeRef.current = null;
    }
  }

  const pending = state === "pending";
  const feedback =
    state === "invalid"
      ? t.invalidContact
      : state === "unavailable"
        ? t.contactUnavailable
        : state === "transport"
          ? t.contactError
          : null;

  return (
    <section
      data-asset-tag-contact
      aria-label={t.contactTitle}
      className="space-y-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h2 className="font-semibold">{t.contactTitle}</h2>
      {state === "sent" ? (
        <p role="status" className="text-sm">
          {t.sent}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t.contactHelp}</p>
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor={id} className="block text-sm font-medium">
                {t.message}
              </label>
              <Textarea
                id={id}
                value={message}
                dir="auto"
                rows={4}
                maxLength={2000}
                required
                disabled={pending}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-email`} className="block text-sm font-medium">
                {t.email}
              </label>
              <Input
                id={`${id}-email`}
                type="email"
                dir="ltr"
                value={reply}
                maxLength={254}
                autoComplete="email"
                disabled={pending}
                onChange={(event) => setReply(event.currentTarget.value)}
              />
            </div>
            {feedback !== null && (
              <p role="alert" className="text-sm text-destructive">
                {feedback}
              </p>
            )}
            <Button type="submit" disabled={pending || message.trim() === ""}>
              <Send aria-hidden="true" className="size-4" />
              {pending ? t.sending : t.send}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}

export function AssetTagLanding({
  token,
  signedIn,
  signInHref,
  contactAvailable,
  fixture,
  resolve,
  sendMessage,
}: AssetTagLandingProps) {
  const t = assetTagLandingMessages[useLocale()];
  return (
    <main
      data-asset-tag-landing
      className={`${BLOCK_CLASS} ph-no-capture mx-auto w-full max-w-xl px-4 py-8 sm:px-6`}
    >
      <PageHeading
        title={t.title}
        actions={fixture === true ? <Badge variant="outline">{t.demo}</Badge> : undefined}
      />
      {signedIn ? (
        resolve === undefined ? (
          <p role="status" className="rounded-lg border bg-card p-4 text-sm">
            {t.unavailable}
          </p>
        ) : (
          <AuthorizedTag key={token} token={token} resolve={resolve} words={t} />
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 sm:p-5">
            <p className="text-sm">{t.publicIntro}</p>
            <a className={buttonVariants()} href={localPath(signInHref) ?? "/login"}>
              {t.signIn}
            </a>
          </div>
          {contactAvailable && sendMessage !== undefined && (
            <TagMessage key={token} token={token} send={sendMessage} words={t} />
          )}
        </div>
      )}
    </main>
  );
}
