"use client";

import { type FormEvent, useRef, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsFeedback,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  type OperationsAccessCommand,
  type OperationsAccessError,
  type OperationsAccessResult,
  type OperationsAccessWorkspace,
  type OperationsGrant,
  type OperationsRole,
  operationsRoles,
} from "../contracts";
import { executeOperationsAccessAction } from "./actions";
import { operationsAccessMessages } from "./messages";

const mask = `${BLOCK_CLASS} ph-no-capture`;
const portalClassName = `${mask} max-h-[min(22rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-y-auto`;
const triggerClassName = "h-9 min-w-0 [&>span]:min-w-0 [&>span]:truncate";

type Labels = (typeof operationsAccessMessages)["en"];
type Change = Omit<OperationsAccessCommand, "requestId">;
type Save = (change: Change) => Promise<boolean>;
type Feedback = "granted" | "revoked" | "transport" | OperationsAccessError;
type StaffMember = OperationsAccessWorkspace["staff"][number];

function GrantForm({
  siteId,
  staff,
  grants,
  t,
  pending,
  save,
}: {
  siteId: string;
  staff: StaffMember[];
  grants: OperationsGrant[];
  t: Labels;
  pending: boolean;
  save: Save;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<OperationsRole | "">("");
  const eligible = staff.filter(({ eligible }) => eligible);
  const openRoles = operationsRoles.filter(
    (role) => !grants.some((grant) => grant.userId === userId && grant.role === role),
  );
  const selectedStaff = eligible.some(({ id }) => id === userId);
  const canGrant = !pending && selectedStaff && role !== "" && openRoles.includes(role);

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role === "" || !canGrant) return;
    const saved = await save({ siteId, userId, role, enabled: true });
    if (saved) setRole("");
  }

  return (
    <SettingsCard>
      <SettingsCardHeader title={t.assign} />
      <SettingsCardBody>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noEligibleStaff}</p>
        ) : (
          <form onSubmit={(event) => void grant(event)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 grow basis-56 space-y-1.5">
              <span className="text-sm font-medium">{t.staff}</span>
              <Select
                ariaLabel={t.staff}
                placeholder={t.chooseStaff}
                value={userId}
                onChange={(id) => {
                  setUserId(id);
                  setRole("");
                }}
                options={eligible.map(({ id, name, email }) => ({
                  value: id,
                  label: `${name} (${email})`,
                }))}
                triggerClassName={triggerClassName}
                contentClassName={portalClassName}
                disabled={pending}
              />
            </div>
            <div className="min-w-0 grow basis-40 space-y-1.5">
              <span className="text-sm font-medium">{t.role}</span>
              <Select
                ariaLabel={t.role}
                placeholder={t.chooseRole}
                value={role}
                onChange={(value) => setRole(operationsRoles.find((role) => role === value) ?? "")}
                options={openRoles.map((role) => ({ value: role, label: t.roles[role] }))}
                triggerClassName={triggerClassName}
                contentClassName={portalClassName}
                disabled={pending || !selectedStaff || openRoles.length === 0}
              />
            </div>
            <Button type="submit" className="h-9" disabled={!canGrant}>
              {t.grant}
            </Button>
          </form>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}

function AssignedRoles({
  grants,
  staff,
  t,
  save,
  pending,
}: {
  grants: OperationsGrant[];
  staff: StaffMember[];
  t: Labels;
  save: Save;
  pending: boolean;
}) {
  const heading = useRef<HTMLSpanElement>(null);
  const members = new Map(staff.map((member) => [member.id, member]));

  async function revoke(grant: OperationsGrant) {
    if (await save({ ...grant, enabled: false })) heading.current?.focus();
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={
          <span tabIndex={-1} ref={heading}>
            {t.assignments}
          </span>
        }
      />
      {grants.length === 0 ? (
        <SettingsCardBody>
          <p className="text-sm text-muted-foreground">{t.noGrants}</p>
        </SettingsCardBody>
      ) : (
        <ul aria-label={t.assignments} className="divide-y">
          {grants.map((grant) => {
            const member = members.get(grant.userId);
            const name = member?.name ?? t.missingStaff;
            const role = t.roles[grant.role];
            return (
              <li
                key={`${grant.userId}:${grant.role}`}
                data-operations-user-id={grant.userId}
                data-operations-role={grant.role}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-sm"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="wrap-anywhere font-medium">
                    <bdi>{name}</bdi>
                  </p>
                  {member !== undefined && (
                    <p className="wrap-anywhere text-xs text-muted-foreground">
                      <bdi>{member.email}</bdi>
                    </p>
                  )}
                </div>
                {member?.eligible === false && (
                  <span className="text-xs text-muted-foreground">{t.inactiveStaff}</span>
                )}
                <Badge variant="outline">{role}</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t.revokeLabel.replace("{role}", role).replace("{name}", name)}
                  disabled={pending}
                  onClick={() => void revoke(grant)}
                >
                  {t.revoke}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

export function OperationsAccessPanel({
  actorId,
  initial,
}: {
  actorId: string;
  initial: OperationsAccessResult;
}) {
  const t = operationsAccessMessages[useLocale()];
  const [current, setCurrent] = useState<OperationsAccessResult>();
  const [siteId, setSiteId] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);
  const unresolved = useRef(new Map<string, string>());
  const result = current ?? initial;

  async function save(change: Change) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);

    const changeKey = JSON.stringify([change.siteId, change.userId, change.role, change.enabled]);
    const requestId = unresolved.current.get(changeKey) ?? crypto.randomUUID();
    unresolved.current.set(changeKey, requestId);
    try {
      const response = await executeOperationsAccessAction(
        actorId,
        { ...change, requestId },
        readCsrfToken(),
      );
      unresolved.current.delete(changeKey);
      if (!response.ok) {
        if (response.error === "unavailable") setCurrent(response);
        setFeedback(response.error);
        return false;
      }
      setCurrent(response);
      setFeedback(change.enabled ? "granted" : "revoked");
      return true;
    } catch {
      setFeedback("transport");
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (!result.ok) {
    return (
      <SettingsCard>
        <SettingsCardBody className="flex flex-wrap items-center justify-between gap-3">
          <SettingsFeedback tone="error">{t.unavailable}</SettingsFeedback>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            {t.retry}
          </Button>
        </SettingsCardBody>
      </SettingsCard>
    );
  }

  const { sites, staff, grants } = result.value;
  const site =
    sites.find(({ id }) => id === siteId) ?? sites.find(({ archived }) => !archived) ?? sites[0];
  if (site === undefined) {
    return (
      <SettingsCard>
        <SettingsCardBody>
          <p className="text-sm text-muted-foreground">{t.noSites}</p>
        </SettingsCardBody>
      </SettingsCard>
    );
  }
  const siteGrants = grants.filter(({ siteId }) => siteId === site.id);
  const success = feedback === "granted" || feedback === "revoked";
  return (
    <div className={`${mask} space-y-4`} aria-busy={pending}>
      <div className="max-w-md space-y-1.5">
        <span className="text-sm font-medium">{t.site}</span>
        <Select
          ariaLabel={t.site}
          placeholder={t.chooseSite}
          value={site.id}
          onChange={(id) => {
            setSiteId(id);
            setFeedback(null);
          }}
          options={sites.map(({ id, code, name, archived }) => ({
            value: id,
            label: `${name} · ${code}${archived ? ` (${t.archived})` : ""}`,
          }))}
          triggerClassName={triggerClassName}
          contentClassName={portalClassName}
          disabled={pending}
        />
      </div>
      {site.archived ? (
        <p className="text-sm text-muted-foreground">{t.archivedSite}</p>
      ) : (
        <GrantForm
          key={site.id}
          {...{ siteId: site.id, staff, grants: siteGrants, t, pending, save }}
        />
      )}
      <AssignedRoles grants={siteGrants} staff={staff} t={t} pending={pending} save={save} />
      {pending && <SettingsFeedback>{t.pending}</SettingsFeedback>}
      {feedback === "freshAuth" && <IdentityActionError message="fresh_auth_required" />}
      {feedback !== null && feedback !== "freshAuth" && (
        <SettingsFeedback tone={success ? "success" : "error"}>{t[feedback]}</SettingsFeedback>
      )}
    </div>
  );
}
