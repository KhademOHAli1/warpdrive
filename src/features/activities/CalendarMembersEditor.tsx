"use client";
import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { setCalendarMemberAction } from "./calendarActions";
import type { CalendarMutationResult } from "./useCalendarMutation";

type Role = "reader" | "editor" | "freeBusy";
export function CalendarMembersEditor({
  calendarId,
  ownerId,
  run,
}: {
  calendarId: string;
  ownerId: string;
  run: (work: () => Promise<CalendarMutationResult>) => Promise<void>;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const query = trpc.calendars.members.useQuery({ id: calendarId });
  const users = trpc.identity.assignableUsers.useQuery();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const options: { value: Role; label: string }[] = [
    { value: "freeBusy", label: t("settings.roleFreeBusy") },
    { value: "reader", label: t("settings.roleReader") },
    { value: "editor", label: t("settings.roleEditor") },
  ];
  function change(id: string, next: Role | null): void {
    void run(async () => {
      const result = await setCalendarMemberAction(
        { calendarId, userId: id, role: next },
        readCsrfToken(),
      );
      if (result.ok) {
        await query.refetch();
        setUserId("");
      }
      return result;
    });
  }
  return (
    <section className="space-y-4 border-t border-border/70 pt-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("settings.sharing")}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.sharingHint")}</p>
      </div>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("settings.loadFailed")}
        </p>
      ) : (
        <ul className="space-y-2">
          {(query.data ?? []).map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
            >
              <bdi dir="auto" className="min-w-24 flex-1 text-sm font-medium">
                {member.name}
              </bdi>
              <Select
                ariaLabel={t("settings.memberRole", { name: member.name })}
                value={member.role}
                options={options}
                triggerClassName="w-44"
                onChange={(value) => {
                  if (value === "reader" || value === "editor" || value === "freeBusy")
                    change(member.userId, value);
                }}
              />
              <Tip label={t("settings.removeMember", { name: member.name })}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("settings.removeMember", { name: member.name })}
                  onClick={() => change(member.userId, null)}
                >
                  <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 rounded-lg border border-dashed bg-muted/20 p-3">
        <Combobox
          ariaLabel={t("settings.addMember")}
          value={userId}
          options={(users.data ?? [])
            .filter(
              (user) =>
                user.id !== ownerId &&
                !(query.data ?? []).some((member) => member.userId === user.id),
            )
            .map((user) => ({ value: user.id, label: user.name }))}
          onChange={setUserId}
        />
        <div className="flex flex-wrap gap-2">
          <Select
            ariaLabel={t("settings.accessLevel")}
            value={role}
            options={options}
            triggerClassName="min-w-44 flex-1"
            onChange={(value) => {
              if (value === "reader" || value === "editor" || value === "freeBusy") setRole(value);
            }}
          />
          <Button variant="outline" disabled={userId === ""} onClick={() => change(userId, role)}>
            <UserPlus className="size-4" aria-hidden />
            {t("settings.share")}
          </Button>
        </div>
      </div>
    </section>
  );
}
