"use client";
import { useEffect, useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { agencyProjectOptionsAction, createAgencyProjectAction } from "./actions";
import { agencyProjectsTranslator } from "./agencyProjectsMessages";
import { ProjectCreationForm } from "./ProjectCreationForm";
import type { ProjectCreationDraft } from "./projectCreationUiTypes";

type Choice = { id: string; label: string };
export function ProjectCreatePanel(props: {
  actorId: string;
  actorName: string;
  onCreated: (id: string) => void;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const t = agencyProjectsTranslator(locale, numberingSystem);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<{ clients: Choice[]; owners: Choice[] }>({
    clients: [],
    owners: [],
  });
  const [client, setClient] = useState<Choice | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ProjectCreationDraft>>({});
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void agencyProjectOptionsAction(props.actorId, query)
        .then((result) => {
          if (alive) setChoices(result.ok ? result.value : { clients: [], owners: [] });
        })
        .catch(() => {
          if (alive) setChoices({ clients: [], owners: [] });
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [props.actorId, query]);
  function selectClient(id: string) {
    const selected = choices.clients.find((choice) => choice.id === id);
    if (!selected) return;
    const key = `${props.actorId}:${selected.id}`;
    setDrafts((current) =>
      current[key]
        ? current
        : {
            ...current,
            [key]: {
              contextKey: key,
              attempt: null,
              input: {
                intentId: crypto.randomUUID(),
                title: "",
                ownerUserId: props.actorId,
                orgId: id,
                personId: null,
                dealId: null,
              },
            },
          },
    );
    setClient(selected);
  }
  const contextKey = client === null ? "" : `${props.actorId}:${client.id}`;
  const draft = drafts[contextKey];
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t("createProject")}</h2>
      <Combobox
        ariaLabel={t("screen.client")}
        placeholder={t("screen.chooseClient")}
        value={client?.id ?? ""}
        options={choices.clients.map(({ id, label }) => ({ value: id, label }))}
        onChange={selectClient}
        search={{ value: query, onChange: setQuery }}
      />
      {client !== null && draft !== undefined && (
        <ProjectCreationForm
          contextKey={contextKey}
          draft={draft}
          contextLabel={client.label}
          canCreate
          owners={choices.owners}
          onDraftChange={(next) => setDrafts((current) => ({ ...current, [contextKey]: next }))}
          submit={async (input, signal) => {
            signal.throwIfAborted();
            const result = await createAgencyProjectAction(props.actorId, input, readCsrfToken());
            signal.throwIfAborted();
            return result;
          }}
          onCreated={props.onCreated}
        />
      )}
    </section>
  );
}
