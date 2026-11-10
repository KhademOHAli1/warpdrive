"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { RichTextBody } from "@/features/email/composer/RichTextBodyLazy";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useFormatters } from "@/lib/useFormatters";
import { useCampaignMessages } from "./messages";
import {
  type Campaign,
  type CampaignFields,
  campaignContentType,
  campaignFields,
  campaignTransitions,
  canEditCampaign,
  type DeliveryConfig,
  type MediaItem,
  type Page,
  type TemplateItem,
  type transitionTargets,
} from "./model";
import {
  CampaignHeading,
  DeleteConfirmation,
  Field,
  NewsletterPreview,
  panelClass,
  QueryState,
  WriteMessage,
} from "./ui";

interface Choice {
  id: number;
  name: string;
}
type StatusAction = (typeof transitionTargets)[number];

interface Draft {
  name: string;
  subject: string;
  lists: Choice[];
  media: { id: number; filename: string }[];
  fromEmail: string;
  messenger: string;
  sendAt: string;
  contentType: Campaign["content_type"];
  body: string;
  bodySource: string;
  altbody: string;
  templateId: number | null;
  tags: string;
  headers: string;
  attributes: string;
}

function localInputValue(value: string | null | undefined) {
  if (value == null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function draftOf(campaign?: Campaign): Draft {
  return {
    name: campaign?.name ?? "",
    subject: campaign?.subject ?? "",
    lists:
      campaign?.lists.flatMap((list) =>
        list.id === null ? [] : [{ id: list.id, name: list.name }],
      ) ?? [],
    media:
      campaign?.media.flatMap((item) =>
        item.id === null ? [] : [{ id: item.id, filename: item.filename }],
      ) ?? [],
    fromEmail: campaign?.from_email ?? "",
    messenger: campaign?.messenger ?? "email",
    sendAt: localInputValue(campaign?.send_at),
    contentType: campaign?.content_type ?? "richtext",
    body: campaign?.body ?? "",
    bodySource: campaign?.body_source ?? "",
    altbody: campaign?.altbody ?? "",
    templateId: campaign?.template_id ?? null,
    tags: campaign?.tags.join(", ") ?? "",
    headers: JSON.stringify(campaign?.headers ?? [], null, 2),
    attributes: JSON.stringify(campaign?.attribs ?? {}, null, 2),
  };
}

function toPayload(draft: Draft, previous: Campaign | undefined): CampaignFields | null {
  const previousInputTime = localInputValue(previous?.send_at);
  const hasExistingTime = previous?.send_at != null && draft.sendAt === previousInputTime;
  const scheduledTime = draft.sendAt ? new Date(draft.sendAt) : null;
  const sendAt =
    scheduledTime === null
      ? null
      : hasExistingTime
        ? previous.send_at
        : Number.isNaN(scheduledTime.getTime())
          ? null
          : scheduledTime.toISOString();
  let headers: unknown;
  let attribs: unknown;
  try {
    headers = JSON.parse(draft.headers);
    attribs = JSON.parse(draft.attributes);
    if (draft.contentType === "visual" && draft.bodySource) JSON.parse(draft.bodySource);
  } catch {
    return null;
  }
  const result = campaignFields.safeParse({
    name: draft.name,
    subject: draft.subject,
    lists: draft.lists.map((list) => list.id),
    media: draft.media.map((item) => item.id),
    from_email: draft.fromEmail,
    messenger: draft.messenger,
    send_at: sendAt,
    content_type: draft.contentType,
    body: draft.body,
    body_source: draft.contentType === "visual" ? draft.bodySource || null : null,
    altbody: draft.contentType !== "plain" ? draft.altbody || null : null,
    template_id: draft.contentType === "visual" ? null : draft.templateId,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    headers,
    attribs,
  });
  return result.success ? result.data : null;
}

function MessageBody({
  draft,
  onChange,
  disabled,
}: {
  draft: Draft;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const m = useCampaignMessages();
  const [source, setSource] = useState(draft.body !== "");
  const acceptEditorChange = useRef(false);
  const rich = draft.contentType === "richtext" && !source && !disabled;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        {rich ? (
          <span className="text-sm font-medium">{m.content}</span>
        ) : (
          <label htmlFor="campaign-body" className="text-sm font-medium">
            {m.content}
          </label>
        )}
        {draft.contentType === "richtext" && !disabled && (
          <label htmlFor="campaign-source-toggle" className="flex items-center gap-2 text-sm">
            <Checkbox
              id="campaign-source-toggle"
              label={m.contentSource}
              checked={source}
              onCheckedChange={setSource}
            />
            {m.contentSource}
          </label>
        )}
      </div>
      {rich ? (
        <div
          onKeyDownCapture={() => {
            acceptEditorChange.current = true;
          }}
          onPointerDownCapture={() => {
            acceptEditorChange.current = true;
          }}
        >
          <RichTextBody
            ariaLabel={m.content}
            frameClassName="rounded-md border"
            html={draft.body}
            onChange={(value) => {
              if (acceptEditorChange.current) onChange(value);
            }}
          />
        </div>
      ) : (
        <Textarea
          id="campaign-body"
          dir="auto"
          className="min-h-48 font-mono"
          value={draft.body}
          readOnly={disabled}
          maxLength={500_000}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

function CampaignAudience({
  selected,
  choices,
  disabled,
  onChange,
}: {
  selected: Choice[];
  choices: Choice[];
  disabled: boolean;
  onChange: (value: Choice[]) => void;
}) {
  const m = useCampaignMessages();
  const available = [
    ...choices,
    ...selected.filter((item) => !choices.some((choice) => choice.id === item.id)),
  ];
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{m.lists}</legend>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Link className="text-link hover:underline" href="/campaigns/lists">
            {m.noLists}
          </Link>
        </p>
      ) : (
        <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
          {available.map((item) => {
            const checked = selected.some((list) => list.id === item.id);
            return (
              <label
                key={item.id}
                htmlFor={`campaign-list-${item.id}`}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id={`campaign-list-${item.id}`}
                  label={item.name}
                  checked={checked}
                  onCheckedChange={(next) =>
                    onChange(
                      next ? [...selected, item] : selected.filter((list) => list.id !== item.id),
                    )
                  }
                />
                <bdi>{item.name}</bdi>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function AttachmentPicker({
  media,
  disabled,
  onChange,
}: {
  media: Draft["media"];
  disabled: boolean;
  onChange: (value: Draft["media"]) => void;
}) {
  const m = useCampaignMessages();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const files = useNewsletterRead<Page<MediaItem>>("media.list", { search }, open && !disabled);
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{m.attachments}</p>
      {media.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={m.selectedAttachments}>
          {media.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-md border ps-2 text-sm">
              <bdi>{item.filename}</bdi>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(media.filter((file) => file.id !== item.id))}
                >
                  {m.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? m.close : m.addAttachment}
          </Button>
          {open && (
            <Input
              aria-label={m.searchMedia}
              placeholder={m.searchMedia}
              className="max-w-xs"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </div>
      )}
      {open && !disabled && (
        <QueryState
          loading={files.isLoading}
          error={files.error}
          empty={files.data?.results.length === 0 ? m.noMedia : undefined}
        >
          <ul className="flex flex-wrap gap-2">
            {files.data?.results
              .filter((item) => !media.some((file) => file.id === item.id))
              .map((item) => (
                <li key={item.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onChange([...media, { id: item.id, filename: item.filename }])}
                  >
                    <bdi>{item.filename}</bdi>
                  </Button>
                </li>
              ))}
          </ul>
        </QueryState>
      )}
    </div>
  );
}

function DeliveryControls({ campaign, dirty }: { campaign: Campaign; dirty: boolean }) {
  const m = useCampaignMessages();
  const router = useRouter();
  const config = useNewsletterRead<{ deliveryEnabled: boolean }>("system.status");
  const write = useNewsletterWrite();
  const [action, setAction] = useState<StatusAction | "test" | "delete" | null>(null);
  const [emails, setEmails] = useState("");
  const [notice, setNotice] = useState("");
  const [inputError, setInputError] = useState("");
  const labels: Record<StatusAction, string> = {
    running: campaign.status === "paused" ? m.resume : m.send,
    scheduled: m.schedule,
    paused: m.pause,
    cancelled: m.cancelCampaign,
    draft: m.returnToDraft,
  };

  function execute() {
    if (!action || write.isPending) return;
    setNotice("");
    const input = { id: campaign.id, confirmed: true };
    if (action === "delete") {
      void write
        .run("campaigns.delete", input)
        .then(() => router.push("/campaigns"))
        .catch(() => undefined);
    } else if (action === "test") {
      void write
        .run("campaigns.test", { ...input, subscribers: addresses })
        .then(() => setNotice(m.testSent))
        .catch(() => undefined);
    } else {
      void write
        .run("campaigns.status", {
          ...input,
          status: action,
          expectedUpdatedAt: campaign.updated_at,
        })
        .then(() => setNotice(m.saved))
        .catch(() => undefined);
    }
  }

  const addresses = [
    ...new Set(
      emails
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const delivery = config.data?.deliveryEnabled === true;
  const transitions = campaignTransitions(campaign);
  const editable = canEditCampaign(campaign.status);
  return (
    <section className={`${panelClass} grid gap-3 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{m[campaign.status]}</Badge>
        {transitions.map((status) => (
          <Button
            key={status}
            variant={status === "cancelled" ? "destructive" : "outline"}
            disabled={
              write.isPending ||
              ((dirty || !delivery) && (status === "running" || status === "scheduled"))
            }
            onClick={() => setAction(status)}
          >
            {labels[status]}
          </Button>
        ))}
        {campaign.status !== "running" && campaign.status !== "scheduled" && (
          <Button variant="outline" disabled={write.isPending} onClick={() => setAction("delete")}>
            {m.delete}
          </Button>
        )}
      </div>
      {!delivery && editable && (
        <p className="text-sm text-muted-foreground">{m.deliveryDisabled}</p>
      )}
      {dirty && editable && <p className="text-sm text-muted-foreground">{m.saveFirst}</p>}
      {editable && (
        <form
          className="grid max-w-lg gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              addresses.length < 1 ||
              addresses.length > 10 ||
              addresses.some((value) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
            ) {
              setInputError(m.testAddressError);
              return;
            }
            setInputError("");
            setAction("test");
          }}
        >
          <Field label={m.testRecipients} htmlFor="campaign-test-emails">
            <Input
              id="campaign-test-emails"
              dir="ltr"
              value={emails}
              maxLength={2_560}
              onChange={(event) => setEmails(event.target.value)}
              disabled={!delivery || dirty}
            />
          </Field>
          {inputError && (
            <p role="alert" className="text-sm text-destructive">
              {inputError}
            </p>
          )}
          <Button
            variant="outline"
            type="submit"
            className="w-fit"
            disabled={!delivery || dirty || write.isPending}
          >
            {m.test}
          </Button>
        </form>
      )}
      <WriteMessage error={write.error} success={notice} />
      <DeleteConfirmation
        open={action === "delete"}
        onClose={() => setAction(null)}
        onConfirm={execute}
        pending={write.isPending}
      />
      <ConfirmDialog
        open={action !== null && action !== "delete"}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={action === "test" ? m.testConfirm : m.confirmDelivery}
        description={action === "test" ? m.testConfirmBody : m.confirmDeliveryBody}
        confirmLabel={
          action === "test" ? m.test : action && action !== "delete" ? labels[action] : m.save
        }
        onConfirm={execute}
        pending={write.isPending}
        destructive={action === "cancelled"}
      />
    </section>
  );
}

function ArchiveControls({
  campaign,
  templates,
}: {
  campaign: Campaign;
  templates: TemplateItem[];
}) {
  const m = useCampaignMessages();
  const write = useNewsletterWrite();
  const [archive, setArchive] = useState(campaign.archive);
  const [slug, setSlug] = useState(campaign.archive_slug ?? "");
  const [template, setTemplate] = useState(String(campaign.archive_template_id ?? ""));
  const [metadata, setMetadata] = useState(JSON.stringify(campaign.archive_meta ?? {}, null, 2));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  function save(event: FormEvent) {
    event.preventDefault();
    let meta: unknown;
    try {
      meta = JSON.parse(metadata);
    } catch {
      setError(m.invalidJson);
      return;
    }
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
      setError(m.invalidJson);
      return;
    }
    setError("");
    setSaved(false);
    void write
      .run("campaigns.archive", {
        id: campaign.id,
        archive,
        archive_slug: slug,
        archive_template_id:
          template === "" ? (templates.find((item) => item.is_default)?.id ?? 0) : Number(template),
        archive_meta: meta,
      })
      .then(() => setSaved(true))
      .catch(() => undefined);
  }
  return (
    <details className={`${panelClass} p-4`}>
      <summary className="cursor-pointer font-medium">{m.archive}</summary>
      <form className="mt-3 grid gap-3" onSubmit={save}>
        <label htmlFor="campaign-archive-enabled" className="flex items-center gap-2 text-sm">
          <Checkbox
            id="campaign-archive-enabled"
            checked={archive}
            label={m.archiveEnabled}
            onCheckedChange={setArchive}
          />
          {m.archiveEnabled}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.archiveSlug} htmlFor="campaign-archive-slug">
            <Input
              id="campaign-archive-slug"
              value={slug}
              maxLength={255}
              onChange={(event) => setSlug(event.target.value)}
            />
          </Field>
          <div className="grid gap-1.5 text-sm font-medium">
            <p>{m.archiveTemplate}</p>
            <Select
              ariaLabel={m.archiveTemplate}
              value={template}
              onChange={setTemplate}
              options={[
                { value: "", label: m.defaultTemplate },
                ...templates
                  .filter((item) => item.type === "campaign")
                  .map((item) => ({ value: String(item.id), label: item.name })),
              ]}
            />
          </div>
        </div>
        <Field label={m.archiveMetadata} htmlFor="campaign-archive-metadata">
          <Textarea
            id="campaign-archive-metadata"
            dir="ltr"
            className="font-mono"
            value={metadata}
            maxLength={10_000}
            onChange={(event) => setMetadata(event.target.value)}
          />
        </Field>
        <Button variant="outline" className="w-fit" type="submit" disabled={write.isPending}>
          {m.save}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <WriteMessage error={write.error} success={saved ? m.saved : undefined} />
      </form>
    </details>
  );
}

function CampaignForm({
  initial,
  lists,
  templates,
  config,
}: {
  initial?: Campaign;
  lists: Choice[];
  templates: TemplateItem[];
  config?: DeliveryConfig;
}) {
  const m = useCampaignMessages();
  const f = useFormatters();
  const router = useRouter();
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [baseline, setBaseline] = useState(() => draftOf(initial));
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(initial?.updated_at);
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const write = useNewsletterWrite<{ id: number } | Campaign>();
  const render = useNewsletterWrite<string>();
  const disabled = initial !== undefined && !canEditCampaign(initial.status);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const currentDraft = initial === undefined ? baseline : draftOf(initial);
  const sameRemoteFields = JSON.stringify(currentDraft) === JSON.stringify(baseline);
  const expectedRevision = sameRemoteFields ? initial?.updated_at : revision;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const messengers = [...new Set([draft.messenger, ...(config?.messengers ?? [])])];
  const templateOptions = templates
    .filter((item) => item.type === "campaign")
    .map((item) => ({ value: String(item.id), label: item.name }));

  function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || write.isPending) return;
    if (draft.lists.length === 0) {
      setFormError(m.listRequired);
      return;
    }
    if (draft.sendAt && !(new Date(draft.sendAt).getTime() > Date.now())) {
      setFormError(m.dateError);
      return;
    }
    const input = toPayload(draft, initial);
    if (!input) {
      setFormError(m.invalidJson);
      return;
    }
    setFormError("");
    void write
      .run(
        initial ? "campaigns.update" : "campaigns.create",
        initial ? { ...input, id: initial.id, expectedUpdatedAt: expectedRevision } : input,
      )
      .then((result) => {
        if (!initial) {
          router.push(`/campaigns/${result.id}`);
          return;
        }
        if ("updated_at" in result) {
          const updated = draftOf(result);
          setRevision(result.updated_at);
          setDraft(updated);
          setBaseline(updated);
        }
        setSaved(true);
      })
      .catch(() => undefined);
  }

  function requestPreview() {
    if (!initial) return;
    void render
      .run("campaigns.preview", {
        id: initial.id,
        body: draft.body,
        content_type: draft.contentType,
        template_id: draft.templateId,
      })
      .then(setPreview)
      .catch(() => undefined);
  }

  return (
    <div className="grid gap-4">
      {initial && (
        <div className={`${panelClass} flex flex-wrap gap-6 p-4 text-sm`}>
          {(
            [
              [m.sent, initial.sent],
              [m.recipients, initial.to_send],
              [m.views, initial.views],
              [m.clicks, initial.clicks],
              [m.bounces, initial.bounces],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-muted-foreground">{label}</p>
              <p className="font-semibold tabular-nums">{f.number(value)}</p>
            </div>
          ))}
          <Link
            className="self-center text-link hover:underline"
            href={`/campaigns/analytics?id=${initial.id}`}
          >
            {m.analytics}
          </Link>
        </div>
      )}
      <form onSubmit={save} className={`${panelClass} grid gap-4 p-4 sm:p-5`}>
        <fieldset disabled={disabled || write.isPending} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={m.name} htmlFor="campaign-name">
              <Input
                id="campaign-name"
                value={draft.name}
                required
                maxLength={255}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>
            <Field label={m.subject} htmlFor="campaign-subject">
              <Input
                id="campaign-subject"
                value={draft.subject}
                required
                maxLength={5_000}
                onChange={(event) => set("subject", event.target.value)}
              />
            </Field>
            <Field label={m.from} htmlFor="campaign-from">
              <Input
                id="campaign-from"
                dir="ltr"
                value={draft.fromEmail}
                placeholder={config?.from_email}
                maxLength={500}
                onChange={(event) => set("fromEmail", event.target.value)}
              />
            </Field>
            <div className="grid gap-1.5 text-sm font-medium">
              <p>{m.messenger}</p>
              <Select
                ariaLabel={m.messenger}
                value={draft.messenger}
                onChange={(value) => set("messenger", value)}
                disabled={disabled || write.isPending}
                options={messengers.map((value) => ({ value, label: value }))}
              />
            </div>
            <Field label={m.scheduleAt} htmlFor="campaign-send-at">
              <Input
                id="campaign-send-at"
                type="datetime-local"
                value={draft.sendAt}
                onChange={(event) => set("sendAt", event.target.value)}
              />
            </Field>
            <Field label={m.tags} htmlFor="campaign-tags">
              <Input
                id="campaign-tags"
                value={draft.tags}
                maxLength={3_000}
                onChange={(event) => set("tags", event.target.value)}
              />
            </Field>
          </div>
          <CampaignAudience
            selected={draft.lists}
            choices={lists}
            disabled={disabled || write.isPending}
            onChange={(value) => set("lists", value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm font-medium">
              <p>{m.contentType}</p>
              <Select
                ariaLabel={m.contentType}
                value={draft.contentType}
                disabled={disabled || write.isPending}
                onChange={(value) => {
                  const parsed = campaignContentType.safeParse(value);
                  if (parsed.success) set("contentType", parsed.data);
                }}
                options={campaignContentType.options.map((value) => ({ value, label: m[value] }))}
              />
            </div>
            {draft.contentType !== "visual" && (
              <div className="grid gap-1.5 text-sm font-medium">
                <p>{m.template}</p>
                <Select
                  ariaLabel={m.template}
                  value={String(draft.templateId ?? "")}
                  disabled={disabled || write.isPending}
                  onChange={(value) => set("templateId", value ? Number(value) : null)}
                  options={[{ value: "", label: m.defaultTemplate }, ...templateOptions]}
                />
              </div>
            )}
          </div>
          <MessageBody
            draft={draft}
            onChange={(value) => set("body", value)}
            disabled={disabled || write.isPending}
          />
          {draft.contentType === "visual" && (
            <Field label={m.source} htmlFor="campaign-body-source">
              <Textarea
                id="campaign-body-source"
                dir="ltr"
                className="font-mono"
                value={draft.bodySource}
                maxLength={500_000}
                onChange={(event) => set("bodySource", event.target.value)}
              />
            </Field>
          )}
          {draft.contentType !== "plain" && (
            <Field label={m.alternative} htmlFor="campaign-alt-body">
              <Textarea
                id="campaign-alt-body"
                value={draft.altbody}
                maxLength={500_000}
                onChange={(event) => set("altbody", event.target.value)}
              />
            </Field>
          )}
          <AttachmentPicker
            media={draft.media}
            disabled={disabled || write.isPending}
            onChange={(value) => set("media", value)}
          />
          <details>
            <summary className="cursor-pointer text-sm font-medium">{m.advanced}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={m.headers} htmlFor="campaign-headers">
                <Textarea
                  id="campaign-headers"
                  dir="ltr"
                  value={draft.headers}
                  maxLength={10_000}
                  onChange={(event) => set("headers", event.target.value)}
                />
              </Field>
              <Field label={m.attributes} htmlFor="campaign-attributes">
                <Textarea
                  id="campaign-attributes"
                  dir="ltr"
                  value={draft.attributes}
                  maxLength={10_000}
                  onChange={(event) => set("attributes", event.target.value)}
                />
              </Field>
            </div>
          </details>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          {!disabled && (
            <Button type="submit" disabled={write.isPending}>
              {initial ? m.save : m.createDraft}
            </Button>
          )}
          {initial && (
            <Button variant="outline" onClick={requestPreview} disabled={render.isPending}>
              {m.preview}
            </Button>
          )}
        </div>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <WriteMessage error={write.error ?? render.error} success={saved ? m.saved : undefined} />
        {preview !== null && (
          <div className="grid gap-2">
            <Button variant="ghost" className="w-fit" onClick={() => setPreview(null)}>
              {m.close}
            </Button>
            <NewsletterPreview body={preview} plain={draft.contentType === "plain"} />
          </div>
        )}
      </form>
      {initial && <DeliveryControls campaign={initial} dirty={dirty} />}
      {initial && <ArchiveControls campaign={initial} templates={templates} />}
    </div>
  );
}

export function CampaignEditor({ campaignId }: { campaignId?: number }) {
  const m = useCampaignMessages();
  const campaign = useNewsletterRead<Campaign>(
    "campaigns.detail",
    { id: campaignId },
    campaignId !== undefined,
  );
  const lists = useNewsletterRead<Choice[]>("lists.minimal");
  const templates = useNewsletterRead<TemplateItem[]>("templates.list");
  const config = useNewsletterRead<DeliveryConfig>("campaigns.config");
  const item = campaign.data;
  return (
    <section className="mx-auto max-w-5xl p-4 sm:p-6">
      <CampaignHeading
        title={campaignId !== undefined ? (item?.name ?? m.editCampaign) : m.newCampaign}
      />
      <QueryState
        loading={campaign.isLoading || lists.isLoading || templates.isLoading || config.isLoading}
        error={campaign.error ?? lists.error ?? templates.error ?? config.error}
        retry={() => {
          if (campaignId !== undefined) void campaign.refetch();
          void lists.refetch();
          void templates.refetch();
          void config.refetch();
        }}
      >
        {(campaignId === undefined || item) && (
          <CampaignForm
            key={campaignId ?? "new"}
            initial={item}
            lists={lists.data ?? []}
            templates={templates.data ?? []}
            config={config.data}
          />
        )}
      </QueryState>
    </section>
  );
}
