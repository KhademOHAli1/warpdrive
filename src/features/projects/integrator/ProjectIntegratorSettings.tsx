"use client";

import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import { useProjectFormatters } from "../ui/useProjectFormatters";
import {
  type ProjectIntegratorAccess,
  type ProjectIntegratorKey,
  projectIntegratorAccess,
  projectIntegratorCurlExample,
} from "./contracts";
import { integratorMessages } from "./messages";

export function ProjectIntegratorSettings({
  actorId,
  initial,
}: {
  actorId: string;
  initial: ProjectIntegratorKey[];
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = integratorMessages[locale];
  const { dateTime } = useProjectFormatters();
  const common = projectsTranslator(locale, numberingSystem);
  const { execute, pending, error } = useProjectWrites();
  const issue = trpc.internalProjects.integrator.issue.useMutation({ gcTime: 0 });
  const revoke = trpc.internalProjects.integrator.revoke.useMutation({ gcTime: 0 });
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<ProjectIntegratorAccess>("read");
  const [expiration, setExpiration] = useState("90");
  const [token, setToken] = useState<string | null>(null);
  const nameId = useId();

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || name.trim() === "") return;
    setToken(null);
    const expiresAt =
      expiration === ""
        ? null
        : new Date(Date.now() + Number(expiration) * 86_400_000).toISOString();
    void execute(
      () =>
        issue.mutateAsync({
          expectedActorId: actorId,
          csrfToken: readCsrfToken(),
          name,
          access,
          expiresAt,
        }),
      ({ token: secret, key }) => {
        issue.reset();
        setToken(secret);
        setName("");
        setKeys((current) => [key, ...current]);
      },
    );
  }

  function remove(keyId: string) {
    void execute(
      () => revoke.mutateAsync({ expectedActorId: actorId, csrfToken: readCsrfToken(), keyId }),
      (key) => {
        setToken(null);
        setKeys((current) => current.map((row) => (row.id === key.id ? key : row)));
      },
    );
  }

  return (
    <section className={`max-w-3xl space-y-5 ${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={labels.title}
        crumbs={[
          { label: common("sections.settings"), href: "/settings" },
          { label: labels.title },
        ]}
      />
      <p className="text-sm text-muted-foreground">{labels.description}</p>
      <pre dir="ltr" className="overflow-auto rounded-md border bg-card p-3 text-sm">
        <code>{projectIntegratorCurlExample}</code>
      </pre>
      <ProjectWriteNotice error={error} labels={common} />
      <form className="grid gap-3 rounded-lg border bg-card p-4" onSubmit={create}>
        <label htmlFor={nameId} className="text-sm font-medium">
          {labels.name}
        </label>
        <Input
          id={nameId}
          value={name}
          required
          maxLength={100}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            ariaLabel={labels.access}
            value={access}
            disabled={pending}
            options={projectIntegratorAccess.map((value) => ({ value, label: labels[value] }))}
            onChange={(value) => setAccess(value === "write" ? "write" : "read")}
          />
          <Select
            ariaLabel={labels.expiration}
            value={expiration}
            onChange={setExpiration}
            disabled={pending}
            options={[
              { value: "30", label: labels.month },
              { value: "90", label: labels.quarter },
              { value: "", label: labels.never },
            ]}
          />
        </div>
        <Button
          type="submit"
          className="justify-self-start"
          disabled={pending || name.trim() === ""}
        >
          {labels.create}
        </Button>
        {token !== null && (
          <div className="grid gap-2 rounded-md border border-primary/40 p-3">
            <p role="status" className="text-sm">
              {labels.copyOnce}
            </p>
            <Input
              value={token}
              readOnly
              aria-label={labels.key}
              dir="ltr"
              className="font-mono"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setToken(null)}
            >
              {labels.hide}
            </Button>
          </div>
        )}
      </form>
      <ul className="divide-y rounded-lg border bg-card">
        {keys.map((key) => (
          <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="space-y-1">
              <bdi className="block font-medium">{key.name}</bdi>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <bdi dir="ltr">••••{key.hint}</bdi>
                <Badge variant="outline">{labels[key.access]}</Badge>
                {key.expiresAt !== null && (
                  <time dateTime={key.expiresAt}>{dateTime(key.expiresAt)}</time>
                )}
              </div>
            </div>
            {key.revokedAt !== null ? (
              <Badge variant="secondary">{labels.revoked}</Badge>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" disabled={pending}>
                    {labels.revoke}
                  </Button>
                }
                title={labels.revoke}
                description={labels.revokePrompt}
                confirmLabel={labels.revoke}
                pending={pending}
                onConfirm={() => remove(key.id)}
              />
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="p-3 text-sm text-muted-foreground">{labels.empty}</li>}
      </ul>
    </section>
  );
}
