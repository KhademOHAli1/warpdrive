"use client";

import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useCampaignMessages } from "./messages";
import { type TemplateItem, templateType } from "./model";
import {
  CampaignHeading,
  cellClass,
  DeleteConfirmation,
  Field,
  headClass,
  NewsletterPreview,
  panelClass,
  QueryState,
  tableClass,
  WriteMessage,
} from "./ui";

type Editor = number | "new";

function TemplateForm({ template, onDone }: { template?: TemplateItem; onDone: () => void }) {
  const m = useCampaignMessages();
  const [name, setName] = useState(template?.name ?? "");
  const [type, setType] = useState<TemplateItem["type"]>(template?.type ?? "campaign");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(
    template?.body ?? '<html><body>{{ template "content" . }}</body></html>',
  );
  const [source, setSource] = useState(template?.body_source ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const write = useNewsletterWrite<TemplateItem>();
  const render = useNewsletterWrite<string>();

  function save(event: FormEvent) {
    event.preventDefault();
    if (write.isPending) return;
    if (type === "campaign_visual" && source) {
      try {
        JSON.parse(source);
      } catch {
        setFormError(m.invalidJson);
        return;
      }
    }
    setFormError("");
    void write
      .run(template ? "templates.update" : "templates.create", {
        ...(template ? { id: template.id } : {}),
        name,
        type,
        subject,
        body,
        ...(type === "campaign_visual" ? { body_source: source || null } : {}),
      })
      .then(onDone)
      .catch(() => undefined);
  }

  function requestPreview() {
    void render
      .run("templates.preview", { type, body })
      .then(setPreview)
      .catch(() => undefined);
  }

  return (
    <form onSubmit={save} className={`${panelClass} grid gap-4 p-4 sm:p-5`}>
      <h2 className="text-base font-semibold">{template ? m.editTemplate : m.newTemplate}</h2>
      <fieldset disabled={write.isPending} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.name} htmlFor="newsletter-template-name">
            <Input
              id="newsletter-template-name"
              required
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="grid gap-1.5 text-sm font-medium">
            <p>{m.templateFormat}</p>
            <Select
              ariaLabel={m.templateFormat}
              value={type}
              disabled={template !== undefined || write.isPending}
              options={templateType.options.map((value) => ({ value, label: m[value] }))}
              onChange={(value) => {
                const parsed = templateType.safeParse(value);
                if (parsed.success) setType(parsed.data);
              }}
            />
          </div>
        </div>
        {type === "tx" && (
          <Field label={m.subject} htmlFor="newsletter-template-subject">
            <Input
              id="newsletter-template-subject"
              required
              value={subject}
              maxLength={5_000}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>
        )}
        <Field label={m.content} htmlFor="newsletter-template-body">
          <Textarea
            id="newsletter-template-body"
            dir="ltr"
            required
            className="min-h-44 font-mono"
            value={body}
            maxLength={500_000}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        {type === "campaign" && <p className="text-sm text-muted-foreground">{m.templateHelp}</p>}
        {type === "campaign_visual" && (
          <Field label={m.source} htmlFor="newsletter-template-source">
            <Textarea
              id="newsletter-template-source"
              dir="ltr"
              className="font-mono"
              value={source}
              maxLength={500_000}
              onChange={(event) => setSource(event.target.value)}
            />
          </Field>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={write.isPending}>
          {m.save}
        </Button>
        <Button variant="outline" onClick={requestPreview} disabled={render.isPending || !body}>
          {m.preview}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {m.close}
        </Button>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <WriteMessage error={write.error ?? render.error} />
      {preview !== null && <NewsletterPreview body={preview} />}
    </form>
  );
}

export function TemplateLibrary() {
  const m = useCampaignMessages();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const query = useNewsletterRead<TemplateItem[]>("templates.list");
  const detail = useNewsletterRead<TemplateItem>(
    "templates.detail",
    { id: editor },
    typeof editor === "number",
  );
  const write = useNewsletterWrite();
  const rows = query.data ?? [];

  function remove() {
    if (target === null || write.isPending) return;
    setNotice("");
    void write
      .run("templates.delete", { id: target, confirmed: true })
      .then(() => {
        setEditor((current) => (current === target ? null : current));
        setNotice(m.saved);
      })
      .catch(() => undefined);
  }

  return (
    <section className="mx-auto max-w-screen-xl space-y-4 p-4 sm:p-6">
      <CampaignHeading
        title={m.templates}
        actions={<Button onClick={() => setEditor("new")}>{m.newTemplate}</Button>}
      />
      {editor === "new" && <TemplateForm key="new" onDone={() => setEditor(null)} />}
      {typeof editor === "number" && (
        <QueryState
          loading={detail.isLoading}
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        >
          {detail.data && (
            <TemplateForm key={editor} template={detail.data} onDone={() => setEditor(null)} />
          )}
        </QueryState>
      )}
      <div className={panelClass}>
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
          empty={rows.length === 0 ? m.noTemplates : undefined}
        >
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={headClass}>
                <tr>
                  {[m.name, m.templateFormat, m.status, m.action].map((column) => (
                    <th key={column} scope="col" className={cellClass}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className={cellClass}>
                      <Button variant="ghost" size="sm" onClick={() => setEditor(item.id)}>
                        <bdi>{item.name}</bdi>
                      </Button>
                    </td>
                    <td className={cellClass}>{m[item.type]}</td>
                    <td className={cellClass}>
                      {item.is_default && <Badge variant="secondary">{m.default}</Badge>}
                    </td>
                    <td className={cellClass}>
                      <div className="flex flex-wrap gap-1">
                        {item.type === "campaign" && !item.is_default && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={write.isPending}
                            onClick={() => {
                              setNotice("");
                              void write
                                .run("templates.default", { id: item.id })
                                .then(() => setNotice(m.saved))
                                .catch(() => undefined);
                            }}
                          >
                            {m.makeDefault}
                          </Button>
                        )}
                        {!item.is_default && (
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </div>
      <WriteMessage error={write.error} success={notice} />
      <DeleteConfirmation
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={remove}
        pending={write.isPending}
      />
    </section>
  );
}
