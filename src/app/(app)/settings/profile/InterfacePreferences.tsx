"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Switch } from "@/components/ui/Switch";
import type { InterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import {
  setOpenDetailsAfterCreateAction,
  setScheduleFollowUpAfterWonAction,
  setUiFlagAction,
} from "@/features/identity/preferencesActions";
import type { OpenDetailsAfterCreate, UiFlagKey } from "@/features/identity/preferencesSchema";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";

function PreferenceGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0 px-5 py-3">
      <h3 id={titleId} className="mb-1 text-xs font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
}): React.ReactNode {
  const id = useId();
  return (
    <div className="flex min-h-9 items-start gap-3 py-1.5">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        label={label}
        className="mt-0.5 shrink-0"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm leading-6 text-start">
        {label}
      </label>
    </div>
  );
}

// Interface personal preferences (Pipedrive parity). Each toggle saves optimistically: flip the
// local state immediately, then persist; on failure revert and surface the error app-wide. No batch
// Save button, matching the schedule-follow-up toggle that already lives on this page.
export function InterfacePreferences({
  prefs,
  scheduleFollowUpAfterWon: initialScheduleFollowUp,
}: {
  prefs: InterfacePrefs;
  scheduleFollowUpAfterWon: boolean;
}): React.ReactNode {
  const L = useSettingsMessages();
  const S = L.interface;
  const FLAG_ROWS: Array<{ key: UiFlagKey; label: string }> = [
    { key: "usPhoneFormat", label: S.usPhoneFormat },
    { key: "winSound", label: S.winSound },
    { key: "emailLinksNewTab", label: S.emailLinksNewTab },
    { key: "prefillParticipantsAsRecipients", label: S.prefillParticipantsAsRecipients },
    { key: "autoPrefixLeadDealTitles", label: S.autoPrefixLeadDealTitles },
  ];

  const router = useRouter();
  const reportError = useActionError();
  const [scheduleFollowUp, setScheduleFollowUp] = useState(initialScheduleFollowUp);
  const [flags, setFlags] = useState({
    scheduleFollowUpAfterDone: prefs.scheduleFollowUpAfterDone,
    usPhoneFormat: prefs.usPhoneFormat,
    winSound: prefs.winSound,
    emailLinksNewTab: prefs.emailLinksNewTab,
    prefillParticipantsAsRecipients: prefs.prefillParticipantsAsRecipients,
    autoPrefixLeadDealTitles: prefs.autoPrefixLeadDealTitles,
  });
  const [openDetails, setOpenDetails] = useState<OpenDetailsAfterCreate>(
    prefs.openDetailsAfterCreate,
  );
  const openDetailsRef = useRef(prefs.openDetailsAfterCreate);
  const persistedOpenDetailsRef = useRef(prefs.openDetailsAfterCreate);
  const openDetailsRevisionRef = useRef(0);
  const openDetailsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function toggleFlag(key: UiFlagKey, next: boolean): Promise<void> {
    setFlags((f) => ({ ...f, [key]: next }));
    const r = await setUiFlagAction({ key, value: next }, readCsrfToken());
    if (!r.ok) {
      setFlags((f) => ({ ...f, [key]: !next }));
      reportError(r.error.id);
      return;
    }
    router.refresh();
  }

  // "Show add activity modal after winning a deal" (Pipedrive's first Interface toggle). Keeps its
  // own dedicated action because the deal page reads this flag directly, not through the client
  // provider.
  async function toggleScheduleFollowUp(next: boolean): Promise<void> {
    setScheduleFollowUp(next);
    const r = await setScheduleFollowUpAfterWonAction({ enabled: next }, readCsrfToken());
    if (!r.ok) {
      setScheduleFollowUp(!next);
      reportError(r.error.id);
      return;
    }
    router.refresh();
  }

  function failOpenDetailsWrite(revision: number, errorId?: string): void {
    // A later queued write contains the full cumulative object and can still persist this intent.
    if (revision !== openDetailsRevisionRef.current) return;
    const persisted = persistedOpenDetailsRef.current;
    openDetailsRef.current = persisted;
    setOpenDetails(persisted);
    reportError(errorId);
  }

  async function persistOpenDetails(next: OpenDetailsAfterCreate, revision: number): Promise<void> {
    try {
      const r = await setOpenDetailsAfterCreateAction(next, readCsrfToken());
      if (!r.ok) {
        failOpenDetailsWrite(revision, r.error.id);
        return;
      }
    } catch {
      failOpenDetailsWrite(revision);
      return;
    }
    persistedOpenDetailsRef.current = next;
    if (revision === openDetailsRevisionRef.current) router.refresh();
  }

  function writeOpenDetails(
    update: (current: OpenDetailsAfterCreate) => OpenDetailsAfterCreate,
  ): void {
    const next = update(openDetailsRef.current);
    const revision = ++openDetailsRevisionRef.current;
    openDetailsRef.current = next;
    setOpenDetails(next);
    openDetailsWriteQueueRef.current = openDetailsWriteQueueRef.current.then(() =>
      persistOpenDetails(next, revision),
    );
  }

  const allOpen = openDetails.leadDeal && openDetails.person && openDetails.org;

  return (
    <SettingsCard>
      <SettingsCardHeader title={L._hierarchy.workflow} description={L._hierarchy.autoSave} />
      <SettingsCardBody className="divide-y p-0">
        <PreferenceGroup title={L._extra.interfaceGroups.followUps}>
          <Row
            label={L.scheduleFollowUpAfterWon}
            checked={scheduleFollowUp}
            onToggle={(v) => void toggleScheduleFollowUp(v)}
          />
          <Row
            label={S.scheduleFollowUpAfterDone}
            checked={flags.scheduleFollowUpAfterDone}
            onToggle={(v) => void toggleFlag("scheduleFollowUpAfterDone", v)}
          />
        </PreferenceGroup>
        <PreferenceGroup title={L._extra.interfaceGroups.recordDetails}>
          <Row
            label={S.openDetailsAfterCreate}
            checked={allOpen}
            onToggle={(v) => writeOpenDetails(() => ({ leadDeal: v, person: v, org: v }))}
          />
          <div className="ms-4 border-s ps-7">
            <Row
              label={S.openDetailsLeadDeal}
              checked={openDetails.leadDeal}
              onToggle={(v) => writeOpenDetails((current) => ({ ...current, leadDeal: v }))}
            />
            <Row
              label={S.openDetailsPerson}
              checked={openDetails.person}
              onToggle={(v) => writeOpenDetails((current) => ({ ...current, person: v }))}
            />
            <Row
              label={S.openDetailsOrg}
              checked={openDetails.org}
              onToggle={(v) => writeOpenDetails((current) => ({ ...current, org: v }))}
            />
          </div>
        </PreferenceGroup>
        <PreferenceGroup title={L._extra.interfaceGroups.displayAndEmail}>
          {FLAG_ROWS.map((row) => (
            <Row
              key={row.key}
              label={row.label}
              checked={flags[row.key]}
              onToggle={(v) => void toggleFlag(row.key, v)}
            />
          ))}
        </PreferenceGroup>
      </SettingsCardBody>
    </SettingsCard>
  );
}
