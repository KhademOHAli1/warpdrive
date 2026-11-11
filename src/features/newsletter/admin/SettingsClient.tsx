"use client";

import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { useNewsletterRead, useNewsletterWrite } from "../ui/client";
import {
  type BouncePolicy,
  isEditableValue,
  type SettingKey,
  type SettingsSection,
  type SettingsSnapshot,
  type SettingValue,
  settingKeys,
  settingSpecs,
} from "./contracts";
import { adminMessages } from "./messages";
import { RelayLimits } from "./RelayLimits";

type Labels = ReturnType<typeof adminMessages>;
type Draft = string | boolean | BouncePolicy;
type Notice = "saved" | "deferred" | null;
const bounceKinds = ["soft", "hard", "complaint"] as const;
const safeBounceActions = ["none", "unsubscribe", "blocklist"] as const;

function asDraft(value: SettingValue): Draft {
  if (Array.isArray(value)) return value.join("\n");
  return typeof value === "number" ? String(value) : value;
}

function asValue(field: SettingKey, draft: Draft): SettingValue {
  const kind = settingSpecs[field].kind;
  if (typeof draft !== "string") return draft;
  if (kind === "number") return draft.trim() === "" ? draft : Number(draft);
  if (kind === "list") {
    return [
      ...new Set(
        draft
          .toLowerCase()
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
  }
  return draft.trim();
}

function fieldHelp(field: SettingKey, L: Labels): string | undefined {
  const help: Partial<Record<SettingKey, string>> = {
    "app.cache_slow_queries_interval": L.scheduleInfo,
    "app.message_sliding_window_duration": L.durationInfo,
    "privacy.domain_allowlist": L.domainInfo,
    "privacy.domain_blocklist": L.domainInfo,
    "upload.extensions": L.extensionInfo,
    "privacy.allow_export": L.disableLegacy,
    "privacy.allow_wipe": L.disableLegacy,
    "privacy.record_optin_ip": L.disableLegacy,
  };
  return help[field];
}

function BounceEditor({
  draft,
  onChange,
  disabled,
  L,
}: {
  draft: BouncePolicy;
  onChange: (draft: Draft) => void;
  disabled: boolean;
  L: Labels;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {bounceKinds.map((kind) => {
        const rule = draft[kind];
        const options: SelectOption[] = safeBounceActions.map((action) => ({
          value: action,
          label: L[action],
        }));
        if (rule.action === "delete") options.unshift({ value: "delete", label: L.legacyDelete });
        return (
          <fieldset key={kind} className="min-w-0 space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{L[kind]}</legend>
            <Input
              aria-label={`${L[kind]} ${L.threshold}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={rule.count === 0 ? "" : rule.count}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, [kind]: { ...rule, count: Number(event.target.value) } })
              }
            />
            <Select
              ariaLabel={`${L[kind]} ${L.bounceAction}`}
              value={rule.action}
              options={options}
              disabled={disabled}
              onChange={(action) => {
                const selected = safeBounceActions.find((value) => value === action);
                if (selected !== undefined)
                  onChange({ ...draft, [kind]: { ...rule, action: selected } });
              }}
            />
          </fieldset>
        );
      })}
    </div>
  );
}

function FieldEditor({
  id,
  field,
  label,
  draft,
  onChange,
  disabled,
  L,
}: {
  id: string;
  field: SettingKey;
  label: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  disabled: boolean;
  L: Labels;
}) {
  if (typeof draft === "boolean") {
    return (
      <Checkbox
        id={id}
        label={label}
        checked={draft}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    );
  }
  if (typeof draft === "object") {
    return <BounceEditor draft={draft} onChange={onChange} disabled={disabled} L={L} />;
  }
  if (settingSpecs[field].kind === "list") {
    return (
      <Textarea
        id={id}
        rows={3}
        value={draft}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      id={id}
      type={settingSpecs[field].kind === "number" ? "number" : "text"}
      value={draft}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SettingForm({
  field,
  current,
  L,
  deliveryEnabled,
  onNotice,
}: {
  field: SettingKey;
  current: SettingValue;
  L: Labels;
  deliveryEnabled: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => asDraft(current));
  const write = useNewsletterWrite<{ reloadDeferred: boolean; unchanged: boolean }>();
  const value = asValue(field, draft);
  const label = L.field(field);
  const help = fieldHelp(field, L);
  const toggle = typeof draft === "boolean";
  const changed = JSON.stringify(value) !== JSON.stringify(current);
  const requiresDelivery =
    value === true &&
    (field === "app.enable_public_subscription_page" || field === "app.send_optin_confirmation");
  const canSave =
    changed && isEditableValue(field, value) && (!requiresDelivery || deliveryEnabled);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || write.isPending) return;
    onNotice(null);
    try {
      const receipt = await write.run("admin.update", { key: field, expected: current, value });
      onNotice(receipt.reloadDeferred ? "deferred" : "saved");
    } catch {
      // The form surfaces the safe error state and retains the authored value.
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className={`space-y-2 border-b p-5 last:border-b-0 ${MASK_CLASS}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {toggle && (
            <FieldEditor
              id={id}
              field={field}
              label={label}
              draft={draft}
              onChange={setDraft}
              disabled={write.isPending}
              L={L}
            />
          )}
          <label
            className="text-sm font-medium"
            htmlFor={typeof draft === "object" ? undefined : id}
          >
            {label}
          </label>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={!canSave || write.isPending}>
          {L.save}
        </Button>
      </div>
      {!toggle && (
        <FieldEditor
          id={id}
          field={field}
          label={label}
          draft={draft}
          onChange={setDraft}
          disabled={write.isPending}
          L={L}
        />
      )}
      {help !== undefined && <p className="text-xs text-muted-foreground">{help}</p>}
      {changed && requiresDelivery && !deliveryEnabled && (
        <p className="text-xs text-muted-foreground">{L.deliveryOff}</p>
      )}
      {write.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {L.writeError}
        </p>
      )}
    </form>
  );
}

function ConnectionRows({
  section,
  snapshot,
  L,
}: {
  section: SettingsSection;
  snapshot: SettingsSnapshot;
  L: Labels;
}) {
  const onOff = (value: boolean) => (value ? L.on : L.off);
  const rows: Partial<Record<SettingsSection, [string, string | number][]>> = {
    general: [
      [L.publicOrigin, snapshot.publicUrlConfigured ? L.configured : L.missing],
      [L.notifyRecipients, snapshot.notifyRecipients],
    ],
    security: [
      [L.captcha, { altcha: "ALTCHA", hcaptcha: "hCaptcha", off: L.off }[snapshot.captcha]],
      [L.trustedOrigins, snapshot.trustedOrigins],
    ],
    media: [
      [L.storage, { s3: "S3", filesystem: L.filesystem, unknown: L.unknown }[snapshot.storage]],
    ],
    smtp: [
      [L.relayProfiles, snapshot.smtpRelays],
      [L.enabledRelays, snapshot.enabledSmtpRelays],
    ],
    bounces: [
      [L.webhooks, onOff(snapshot.bounceWebhooks)],
      [L.bounceMailbox, onOff(snapshot.bounceMailbox)],
    ],
    messengers: [[L.activeMessengers, snapshot.messengers]],
    appearance: [[L.overrides, onOff(snapshot.customAppearance)]],
  };
  const current = rows[section];
  if (current === undefined) return null;
  return (
    <SettingsCardBody className="space-y-2">
      <dl className="space-y-2">
        {current.map(([name, value]) => (
          <div key={name} className="flex items-start justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {section === "general" && <p className="text-xs text-muted-foreground">{L.hostGeneral}</p>}
      {section === "smtp" &&
        snapshot.relayLimits.map((relay, index) => (
          <RelayLimits key={relay.id} relay={relay} index={index} L={L} />
        ))}
    </SettingsCardBody>
  );
}

function ExistingSettings({ section, L }: { section: SettingsSection; L: Labels }) {
  const links: Partial<Record<SettingsSection, [string, string][]>> = {
    general: [
      ["/settings/company", L.workspace],
      ["/settings/company/branding", L.branding],
      ["/settings/regional", L.regional],
    ],
    privacy: [["/settings/privacy", L.privacy]],
    security: [
      ["/settings/security", L.security],
      ["/settings/permission-sets", L.permissionSets],
    ],
    smtp: [["/settings/email-sync", L.emailSync]],
    appearance: [
      ["/settings/appearance", L.appearance],
      ["/settings/company/branding", L.branding],
    ],
  };
  const current = links[section];
  if (current === undefined) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label={L.sections[section]}>
      {current.map(([href, label]) => (
        <Link key={href} href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SettingsClient({ section }: { section: SettingsSection }) {
  const L = adminMessages(useLocale());
  const status = useNewsletterRead<{ configured: boolean }>("system.status");
  const configured = status.data?.configured === true;
  const settings = useNewsletterRead<SettingsSnapshot>("admin.settings", {}, configured);
  const [notice, setNotice] = useState<Notice>(null);
  const snapshot = settings.data;
  const displayedNotice = snapshot?.reloadRequired === true ? "deferred" : notice;
  const refresh = () => {
    if (configured) void settings.refetch();
    else void status.refetch();
  };
  return (
    <>
      <ExistingSettings section={section} L={L} />
      <SettingsCard>
        <SettingsCardHeader
          title={L.sections[section]}
          description={L.sectionInfo(section)}
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={status.isFetching || settings.isFetching}
              onClick={refresh}
            >
              {L.refresh}
            </Button>
          }
        />
        {snapshot === undefined ? (
          <SettingsCardBody>
            <p
              role={settings.isError || status.isError ? "alert" : "status"}
              className="text-sm text-muted-foreground"
            >
              {settings.isError || status.isError
                ? L.unavailable
                : status.data?.configured === false
                  ? L.disconnected
                  : L.loading}
            </p>
          </SettingsCardBody>
        ) : (
          <>
            <ConnectionRows section={section} snapshot={snapshot} L={L} />
            {displayedNotice !== null && (
              <p role="status" className="border-t px-5 py-3 text-sm text-muted-foreground">
                {L[displayedNotice]}
              </p>
            )}
            {settingKeys
              .filter((field) => settingSpecs[field].section === section)
              .map((field) => {
                const current = snapshot.values[field];
                if (current === undefined) {
                  return (
                    <p key={field} className="border-t px-5 py-3 text-sm text-muted-foreground">
                      {L.field(field)} · {L.fieldUnavailable}
                    </p>
                  );
                }
                return (
                  <SettingForm
                    key={`${field}:${JSON.stringify(current)}`}
                    field={field}
                    current={current}
                    L={L}
                    deliveryEnabled={snapshot.deliveryEnabled}
                    onNotice={setNotice}
                  />
                );
              })}
          </>
        )}
      </SettingsCard>
    </>
  );
}
