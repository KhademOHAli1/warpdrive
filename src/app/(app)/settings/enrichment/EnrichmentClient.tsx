"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { EnrichEntity } from "@/features/enrichment/canonical";
import type { QuotaRemaining } from "@/features/enrichment/providers/types";
import {
  clearMappingAction,
  clearProviderKeyAction,
  setCacheTtlAction,
  setMappingAction,
  setProviderEnabledAction,
  setProviderKeyAction,
  testProviderAction,
} from "@/features/enrichment/settingsActions";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { trpc } from "@/lib/trpc-client";
import { useSyncedState } from "@/lib/useSyncedState";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";
import { type MappingRow, MappingTable } from "./MappingTable";
import { ProviderCard, type ProviderCardView } from "./ProviderCard";
import { decodeTarget } from "./targetOptions";
import { useCooldownClock } from "./useCooldownClock";

const MAX_TTL_DAYS = 365;

function without(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(key);
  return next;
}

type ActionResult = { ok: true } | { ok: false; error: { id: string } };
type TestVerdict = {
  text: string;
  quota: QuotaRemaining | null;
  notEntitled: readonly string[] | null;
};

export interface MappingSection {
  entity: EnrichEntity;
  title: string;
  rows: MappingRow[];
  hasCustomFields: boolean;
}

export function EnrichmentClient({
  providers,
  person,
  organization,
  cacheTtlDays,
}: {
  providers: ProviderCardView[];
  person: MappingSection;
  organization: MappingSection;
  cacheTtlDays: number;
}): React.ReactNode {
  const L = useSettingsMessages();
  const locale = useLocale();

  const S = L._enrichment.settings;

  function verdictOf(kind: string): string {
    if (kind === "ok") return S.testOk;
    if (kind === "no_match") return S.testNoMatch;
    const known = Object.hasOwn(L._enrichment.outcome, kind);
    return S.testFailed(
      known ? L._enrichment.outcome[kind as keyof typeof L._enrichment.outcome] : kind,
    );
  }

  const router = useRouter();
  const reportError = useActionError();
  const utils = trpc.useUtils();
  const ttlFieldId = useId();
  const [committedTtl, setCommittedTtl] = useSyncedState(cacheTtlDays);
  const [ttlDraft, setTtlDraft] = useState<{ raw: string; locale: Locale } | null>(null);
  const ttl = ttlDraft?.raw ?? String(committedTtl);
  const ttlRequest = useRef(0);
  const [ttlError, setTtlError] = useState<string | null>(null);
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [testResults, setTestResults] = useState<Record<string, TestVerdict | null>>({});
  const now = useCooldownClock(providers.map((p) => p.throttledUntilIso));
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // Canonical keys are unique across both entities, so one set covers both mapping tables.
  const [mappingPending, setMappingPending] = useState<ReadonlySet<string>>(() => new Set());

  // Every mutation on this page ends here, so a failure always reaches the shared error surface
  // instead of leaving a control that looks like it did something.
  async function run(action: Promise<ActionResult>, onSuccess?: () => void): Promise<void> {
    try {
      const result = await action;
      if (!result.ok) {
        reportError(result.error.id);
        return;
      }
      onSuccess?.();
      // router.refresh redraws this page, not the enrichment.status query the Fill the gaps button
      // holds for five minutes. Without this, a provider connected here stays invisible on a record,
      // and one removed here keeps looking ready, until that cache expires.
      await utils.enrichment.status.invalidate();
      router.refresh();
    } catch {
      // A rejected action carries no error id, so it reports as the generic "couldn't complete
      // that action" rather than a cause the server never named.
      reportError();
    }
  }

  // Two writes to one provider must not overlap: whichever the server finishes last would win,
  // which is not necessarily the one the admin clicked last. Other providers stay clickable.
  async function runForProvider(provider: string, action: Promise<ActionResult>): Promise<void> {
    setPending((current) => new Set(current).add(provider));
    try {
      await run(action);
    } finally {
      setPending((current) => without(current, provider));
    }
  }

  // The test reports its verdict in place rather than through router.refresh, because the useful
  // answer ("the key works") is not a change to any row on the page. Probes are tracked per
  // provider: one slot would let the first probe to answer unlock a card still spending a credit.
  async function test(provider: string): Promise<void> {
    setTesting((current) => new Set(current).add(provider));
    setTestResults((current) => ({ ...current, [provider]: null }));
    try {
      const result = await testProviderAction({ provider }, readCsrfToken());
      if (!result.ok) {
        reportError(result.error.id);
        return;
      }
      setTestResults((current) => ({
        ...current,
        [provider]: {
          text: verdictOf(result.kind),
          quota: result.quotaRemaining ?? null,
          notEntitled: result.notEntitled ?? null,
        },
      }));
      // A probe can badge the key or record a cooldown, both of which the button reads.
      await utils.enrichment.status.invalidate();
      router.refresh();
    } catch {
      // The probe can reject rather than return a verdict (RocketReach rethrows on abort, and any
      // transport failure lands here), which is a failed action, not a provider answer.
      reportError();
    } finally {
      setTesting((current) => without(current, provider));
    }
  }

  function forgetVerdict(provider: string): void {
    setTestResults((current) => ({ ...current, [provider]: null }));
  }

  // Per canonical key, for the same reason providers lock per provider: two writes to one row
  // would let the server's last answer win rather than the admin's last choice.
  async function selectTarget(
    section: MappingSection,
    canonicalKey: string,
    value: string,
  ): Promise<void> {
    const target = decodeTarget(value);
    const csrf = readCsrfToken();
    setMappingPending((current) => new Set(current).add(canonicalKey));
    try {
      await run(
        target === null
          ? clearMappingAction({ entity: section.entity, canonicalKey }, csrf)
          : setMappingAction({ entity: section.entity, canonicalKey, target }, csrf),
      );
    } finally {
      setMappingPending((current) => without(current, canonicalKey));
    }
  }

  function saveTtl(): void {
    // Number("") is 0, and 0 is a legal TTL meaning "never reuse a cached run", so a blank field
    // has to be rejected before the conversion rather than saved as a silent opt-out.
    const raw = ttl.trim();
    const normalized = normalizeNumberInput(raw, ttlDraft?.locale ?? locale);
    const days = normalized === null ? NaN : Number(normalized);
    if (raw === "" || !Number.isInteger(days) || days < 0 || days > MAX_TTL_DAYS) {
      setTtlError(S.cacheInvalid);
      return;
    }
    setTtlError(null);
    const submittedDraft = ttlDraft;
    const request = ++ttlRequest.current;
    void run(setCacheTtlAction({ days }, readCsrfToken()), () => {
      if (request !== ttlRequest.current) return;
      setCommittedTtl(days);
      // A successful commit ends this draft's locale. A later edit is a different object and
      // keeps its text and origin even when the earlier request completes during typing.
      setTtlDraft((current) => (current === submittedDraft ? null : current));
    });
  }

  return (
    <>
      {providers.map((view) => (
        <ProviderCard
          key={view.provider}
          view={view}
          now={now}
          pending={pending.has(view.provider)}
          onToggle={(enabled) =>
            void runForProvider(
              view.provider,
              setProviderEnabledAction({ provider: view.provider, enabled }, readCsrfToken()),
            )
          }
          onSaveKey={(apiKey) => {
            // A verdict describes the key that was tested. router.refresh keeps client state, so
            // without this the card would still say "Key works" about a credential just replaced.
            forgetVerdict(view.provider);
            void runForProvider(
              view.provider,
              setProviderKeyAction({ provider: view.provider, apiKey }, readCsrfToken()),
            );
          }}
          onRemoveKey={() => {
            forgetVerdict(view.provider);
            void runForProvider(
              view.provider,
              clearProviderKeyAction({ provider: view.provider }, readCsrfToken()),
            );
          }}
          onTest={() => void test(view.provider)}
          testing={testing.has(view.provider)}
          testResult={testResults[view.provider]?.text ?? null}
          testQuota={testResults[view.provider]?.quota ?? null}
          testNotEntitled={testResults[view.provider]?.notEntitled ?? null}
        />
      ))}

      <SettingsCard>
        <SettingsCardHeader title={S.mappingTitle} description={S.mappingDescription} />
        <SettingsCardBody className="space-y-6">
          {[person, organization].map((section) => (
            <MappingTable
              key={section.entity}
              title={section.title}
              rows={section.rows}
              hasCustomFields={section.hasCustomFields}
              busyKeys={mappingPending}
              onSelect={(canonicalKey, value) => void selectTarget(section, canonicalKey, value)}
            />
          ))}
        </SettingsCardBody>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader title={S.cacheTitle} description={S.cacheDescription} />
        <SettingsCardBody className="space-y-2">
          <label htmlFor={ttlFieldId} className="block text-sm font-medium">
            {S.cacheLabel}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={ttlFieldId}
              type="text"
              inputMode="numeric"
              min={0}
              max={MAX_TTL_DAYS}
              value={ttl}
              className="w-32"
              onChange={(e) => {
                const raw = e.target.value;
                setTtlDraft((previous) => ({ raw, locale: previous?.locale ?? locale }));
              }}
            />
            <Button size="sm" onClick={saveTtl}>
              {S.cacheSave}
            </Button>
          </div>
          {ttlError !== null && <p className="text-sm text-destructive">{ttlError}</p>}
        </SettingsCardBody>
      </SettingsCard>
    </>
  );
}
