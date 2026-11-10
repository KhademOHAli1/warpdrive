"use client";

import { FileUp } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import {
  AudienceListPicker,
  AudienceReadError,
  AudienceRefresh,
  AudienceWriteError,
} from "./components";
import {
  csvDelimiter,
  type ImportLogEvent,
  type ImportProgress,
  importMaxBytes,
  importMode,
  type MinimalList,
} from "./contracts";
import { type AudienceMessages, useAudienceMessages } from "./messages";

const activeImport = (status: ImportProgress["status"] | undefined) =>
  status === "importing" || status === "stopping";

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += 16_384) {
    pieces.push(String.fromCharCode(...bytes.subarray(i, i + 16_384)));
  }
  return btoa(pieces.join(""));
}

function importLogText(
  L: AudienceMessages,
  event: ImportLogEvent,
  number: (n: number) => string,
): string {
  switch (event.kind) {
    case "started":
      return L.logStarted;
    case "ignoredColumn":
      return L.logIgnoredColumn;
    case "finished":
      return L.logFinished;
    case "stopped":
      return L.logStopped;
    case "failed":
      return L.logFailed;
    case "skippedRow":
      return `${L.logSkippedRow} ${number(event.count)}`;
    case "invalidAttributes":
      return `${L.logInvalidAttributes} ${number(event.count)}`;
    case "committed":
      return `${L.logCommitted} ${number(event.count)}`;
  }
}

function ImportStatusCard({
  data,
  stop,
  pending,
}: {
  data: ImportProgress;
  stop: () => void;
  pending: boolean;
}) {
  const L = useAudienceMessages();
  const format = useFormatters();

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={data.status === "failed" ? "destructive" : "secondary"}>
          {L[data.status]}
        </Badge>
        {data.name && (
          <bdi dir="auto" className="min-w-0 break-all text-sm font-medium">
            {data.name}
          </bdi>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {L.records} {format.number(data.imported)} / {format.number(data.total)}
      </p>
      {data.total > 0 && (
        <progress
          aria-label={L.records}
          className="h-2 w-full accent-primary"
          max={data.total}
          value={data.imported}
        />
      )}
      {data.status === "importing" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={stop}>
          {L.cancelImport}
        </Button>
      )}
    </section>
  );
}

function ImportLog({ events }: { events: ImportLogEvent[] }) {
  const L = useAudienceMessages();
  const format = useFormatters();
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="font-medium">{L.importLog}</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{L.noLogs}</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-sm text-muted-foreground">
          {events.map((event) => (
            <li key={event.id}>{importLogText(L, event, format.number)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Mode = "subscribe" | "blocklist";
type Delimiter = "," | ";" | "\t" | "|";

function ImportForm({
  onStart,
}: {
  onStart: (input: {
    file: File;
    mode: Mode;
    delimiter: Delimiter;
    lists: number[];
    overwriteProfile: boolean;
  }) => void;
}) {
  const L = useAudienceMessages();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [mode, setMode] = useState<Mode>("subscribe");
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [lists, setLists] = useState<number[]>([]);
  const [overwriteProfile, setOverwriteProfile] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const available = useNewsletterRead<MinimalList[]>("lists.minimal", {}, mode === "subscribe");

  function selectFile(next: File | null) {
    const invalidFile =
      next !== null &&
      (next.size === 0 ||
        next.size > importMaxBytes ||
        next.name.length > 120 ||
        !next.name.toLowerCase().endsWith(".csv"));
    setInvalid(invalidFile);
    setFile(invalidFile ? null : next);
  }

  function begin() {
    if (!file || (mode === "subscribe" && lists.length === 0)) return;
    onStart({ file, mode, delimiter, lists, overwriteProfile });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "blocklist") setConfirmation(true);
    else begin();
  }

  return (
    <>
      <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{L.importMode}</p>
            <Select
              ariaLabel={L.importMode}
              value={mode}
              onChange={(value) => setMode(importMode.parse(value))}
              options={[
                { value: "subscribe", label: L.subscribeMode },
                { value: "blocklist", label: L.blocklistMode },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{L.csvDelimiter}</p>
            <Select
              ariaLabel={L.csvDelimiter}
              value={delimiter}
              onChange={(value) => setDelimiter(csvDelimiter.parse(value))}
              options={[
                { value: ",", label: L.comma },
                { value: ";", label: L.semicolon },
                { value: "\t", label: L.tab },
                { value: "|", label: L.pipe },
              ]}
            />
          </div>
        </div>
        <label className="block space-y-1.5" htmlFor={id}>
          <span className="text-sm font-medium">{L.csvFile}</span>
          <Input
            id={id}
            type="file"
            accept=".csv,text/csv"
            aria-describedby={`${id}-hint`}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
          <span id={`${id}-hint`} className="block text-sm text-muted-foreground">
            {L.csvHint}
          </span>
        </label>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {L.invalidCsv}
          </p>
        )}
        {mode === "subscribe" && (
          <>
            <AudienceListPicker
              lists={available.data ?? []}
              value={lists}
              onChange={setLists}
              read={available}
            />
            <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-overwrite`}>
              <Checkbox
                id={`${id}-overwrite`}
                label={L.overwriteProfile}
                checked={overwriteProfile}
                onCheckedChange={setOverwriteProfile}
              />
              {L.overwriteProfile}
            </label>
            <p className="text-sm text-muted-foreground">{L.importConsent}</p>
          </>
        )}
        <Button
          type="submit"
          disabled={file === null || (mode === "subscribe" && lists.length === 0)}
        >
          <FileUp className="size-4" aria-hidden="true" />
          {L.startImport}
        </Button>
      </form>
      <ConfirmDialog
        open={confirmation}
        onOpenChange={setConfirmation}
        title={L.importBlocklistTitle}
        description={L.importBlocklistDetail}
        confirmLabel={L.blocklist}
        destructive
        onConfirm={begin}
      />
    </>
  );
}

export function ImportScreen() {
  const L = useAudienceMessages();
  const [stopping, setStopping] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [fileError, setFileError] = useState(false);
  const status = useNewsletterRead<ImportProgress>("subscribers.importStatus");
  const logs = useNewsletterRead<ImportLogEvent[]>("subscribers.importLogs");
  const write = useNewsletterWrite();
  const running = activeImport(status.data?.status);
  const refreshStatus = status.refetch;
  const refreshLogs = logs.refetch;

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      void refreshStatus();
      void refreshLogs();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [running, refreshStatus, refreshLogs]);

  async function start({
    file,
    ...input
  }: Parameters<Parameters<typeof ImportForm>[0]["onStart"]>[0]) {
    if (readingFile || write.isPending) return;
    setReadingFile(true);
    setFileError(false);
    let content: string;
    try {
      content = await fileBase64(file);
    } catch {
      setFileError(true);
      setReadingFile(false);
      return;
    }
    try {
      await write.run("subscribers.startImport", { ...input, name: file.name, content });
    } catch {
      // The mutation owns the visible error state.
    } finally {
      setReadingFile(false);
    }
  }

  function stop() {
    if (status.data?.status !== "importing") return;
    void write.run("subscribers.cancelImport", { name: status.data.name }).catch(() => undefined);
  }

  return (
    <section className={`space-y-4 ${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading title={L.importSubscribers} actions={<AudienceRefresh read={status} />} />
      <AudienceWriteError error={write.error} />
      {fileError && (
        <p role="alert" className="text-sm text-destructive">
          {L.invalidCsv}
        </p>
      )}
      {status.error && <AudienceReadError read={status} />}
      {status.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.loading}
        </p>
      )}
      {status.data && (
        <ImportStatusCard
          data={status.data}
          stop={() => setStopping(true)}
          pending={write.isPending}
        />
      )}
      {status.data && !running && !status.error && (
        <div aria-busy={readingFile || write.isPending} inert={readingFile || write.isPending}>
          <ImportForm onStart={(input) => void start(input)} />
        </div>
      )}
      {logs.error ? <AudienceReadError read={logs} /> : <ImportLog events={logs.data ?? []} />}
      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={L.cancelImportTitle}
        description={L.cancelImportDetail}
        confirmLabel={L.cancelImport}
        destructive
        pending={write.isPending}
        onConfirm={stop}
      />
    </section>
  );
}
