"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { LocationSiteGrant, LocationsIntent, LocationsWorkspace } from "./contracts";
import type { Site } from "./directory";
import type { LocationWriteError } from "./LocationsDirectory";
import { locationsMessages } from "./locationsMessages";

type GrantIntent = Extract<LocationsIntent, { type: "setGrant" }>;

function memberLabel({ name, email }: LocationsWorkspace["eligibleUsers"][number]) {
  return `${name} (${email})`;
}

export function LocationAccessDialog({
  site,
  users,
  grants,
  pending,
  close,
  focusTrigger,
  submit,
}: {
  site: Site;
  users: LocationsWorkspace["eligibleUsers"];
  grants: LocationSiteGrant[];
  pending: boolean;
  close: () => void;
  focusTrigger: () => void;
  submit: (change: GrantIntent) => Promise<LocationWriteError | null>;
}) {
  const locale = useLocale();
  const t = locationsMessages[locale];
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<LocationSiteGrant["role"]>("viewer");
  const [error, setError] = useState<LocationWriteError | null>(null);
  const [saved, setSaved] = useState(false);
  const canGrant = !pending && users.some(({ id }) => id === userId);
  const mask = `${BLOCK_CLASS} ph-no-capture`;

  async function changeAccess(userId: string, role: GrantIntent["role"]) {
    if (pending) return;
    setError(null);
    setSaved(false);
    const failure = await submit({ type: "setGrant", siteId: site.id, userId, role });
    setError(failure);
    setSaved(failure === null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canGrant) void changeAccess(userId, role);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending && !open) close();
      }}
    >
      <DialogContent
        className={`${mask} max-h-[calc(100dvh-2rem)] overflow-y-auto`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusTrigger();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.siteAccess}</DialogTitle>
          <DialogDescription>{t.siteAccessDescription}</DialogDescription>
        </DialogHeader>
        <p className="break-words text-sm font-semibold">
          <bdi>{site.name}</bdi> · <bdi dir="ltr">{site.code}</bdi>
        </p>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noGrants}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((grant) => {
              const member = users.find(({ id }) => id === grant.userId);
              const label = member ? memberLabel(member) : t.unavailableMember;
              return (
                <li
                  key={grant.userId}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 break-words">
                    <bdi className="block font-medium">{label}</bdi>
                    <span className="text-muted-foreground">{t[grant.role]}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={t.revokeAccessFor.replace("{name}", label)}
                    onClick={() => void changeAccess(grant.userId, null)}
                  >
                    {t.revokeAccess}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {users.length > 0 ? (
          <form onSubmit={onSubmit} className="grid gap-3 border-t pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <span className="text-sm font-medium">{t.staffMember}</span>
                <Select
                  ariaLabel={t.staffMember}
                  value={userId}
                  onChange={(id) => {
                    setUserId(id);
                    setRole(grants.find(({ userId }) => userId === id)?.role ?? "viewer");
                    setError(null);
                    setSaved(false);
                  }}
                  disabled={pending}
                  placeholder={t.selectMember}
                  options={users.map((member) => ({
                    value: member.id,
                    label: memberLabel(member),
                  }))}
                  triggerClassName="h-9 min-w-0 [&>span]:min-w-0 [&>span]:truncate"
                  contentClassName={`${mask} max-w-[min(28rem,90vw)]`}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t.siteRole}</span>
                <Select
                  ariaLabel={t.siteRole}
                  value={role}
                  onChange={(value) => setRole(value === "manager" ? "manager" : "viewer")}
                  disabled={pending}
                  options={[
                    { value: "viewer", label: t.viewer },
                    { value: "manager", label: t.manager },
                  ]}
                  triggerClassName="h-9"
                  contentClassName={`${mask} max-w-[min(28rem,90vw)]`}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!canGrant}>
                {t.grantAccess}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t.noEligibleMembers}</p>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t[error]}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t.saved}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
