"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type { BookingSite } from "../contracts";
import type {
  BookingMembershipCommand,
  BookingMembershipResult,
  BookingMembershipRole,
  BookingMembershipWorkspace,
} from "../membershipContracts";

const en = {
  heading: "Booking access",
  instructions: "Give staff permission to request equipment at this site.",
  staff: "Staff member",
  chooseStaff: "Select a staff member",
  role: "Booking role",
  base: "Base requester",
  self_service: "Self-service",
  set: "Save booking access",
  revoke: "Revoke access",
  revokeFor: "Revoke access for {name}",
  empty: "No booking memberships at this site.",
  unknown: "Unavailable staff member",
  saved: "Booking access updated.",
  unavailable: "Booking access is unavailable.",
  invalid: "Choose an eligible staff member and a booking role.",
  conflict: "Access changed. Refresh the page and try again.",
  transport: "The change could not be confirmed. Try again.",
};

const words: Record<Locale, typeof en> = {
  en,
  de: {
    heading: "Buchungszugriff",
    instructions: "Erlauben Sie Mitarbeitenden, Geräte an diesem Standort anzufragen.",
    staff: "Mitarbeitende Person",
    chooseStaff: "Person auswählen",
    role: "Buchungsrolle",
    base: "Anfragende",
    self_service: "Selbstbedienung",
    set: "Buchungszugriff speichern",
    revoke: "Zugriff entziehen",
    revokeFor: "Zugriff für {name} entziehen",
    empty: "Für diesen Standort sind keine Buchungsrollen vergeben.",
    unknown: "Nicht verfügbare Person",
    saved: "Buchungszugriff aktualisiert.",
    unavailable: "Der Buchungszugriff ist nicht verfügbar.",
    invalid: "Wählen Sie eine berechtigte Person und eine Buchungsrolle aus.",
    conflict: "Der Zugriff wurde geändert. Laden Sie die Seite neu und versuchen Sie es erneut.",
    transport: "Die Änderung konnte nicht bestätigt werden. Versuchen Sie es erneut.",
  },
  fa: {
    heading: "دسترسی رزرو",
    instructions: "به کارکنان اجازه دهید تجهیزات این محل را درخواست کنند.",
    staff: "کارمند",
    chooseStaff: "یک کارمند انتخاب کنید",
    role: "نقش رزرو",
    base: "درخواست‌کننده",
    self_service: "خودخدمت",
    set: "ذخیره دسترسی رزرو",
    revoke: "لغو دسترسی",
    revokeFor: "لغو دسترسی {name}",
    empty: "برای این محل هیچ نقش رزروی تخصیص داده نشده است.",
    unknown: "کارمند در دسترس نیست",
    saved: "دسترسی رزرو به‌روز شد.",
    unavailable: "دسترسی رزرو در دسترس نیست.",
    invalid: "یک کارمند واجد شرایط و یک نقش رزرو انتخاب کنید.",
    conflict: "دسترسی تغییر کرده است. صفحه را دوباره بارگیری کنید و دوباره تلاش کنید.",
    transport: "تأیید تغییر ممکن نبود. دوباره تلاش کنید.",
  },
};

export type BookingMembershipAccess = {
  workspace: BookingMembershipWorkspace;
  submit: (command: BookingMembershipCommand) => Promise<BookingMembershipResult>;
};

type Feedback = Extract<BookingMembershipResult, { ok: false }>["error"] | "saved" | "transport";

export function BookingMembershipPanel({
  site,
  workspace,
  submit,
}: BookingMembershipAccess & { site: BookingSite }) {
  const t = words[useLocale()];
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<BookingMembershipRole>("base");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const request = useRef<BookingMembershipCommand | null>(null);
  const running = useRef(false);
  const members = workspace.memberships.filter(({ siteId }) => siteId === site.id);
  const names = new Map(workspace.staff.map(({ id, name }) => [id, name]));
  const eligible = workspace.staff.filter(({ eligible }) => eligible);
  const currentRole = members.find((member) => member.userId === userId)?.role;
  const canSet = eligible.some(({ id }) => id === userId) && currentRole !== role;

  async function save(memberId: string, nextRole: BookingMembershipRole | null) {
    if (running.current || !site.canConfigure) return;
    running.current = true;
    setPending(true);
    setFeedback(null);
    const prior = request.current;
    const command = {
      siteId: site.id,
      userId: memberId,
      role: nextRole,
      requestId:
        prior?.userId === memberId && prior.role === nextRole
          ? prior.requestId
          : crypto.randomUUID(),
    };
    request.current = command;
    try {
      const result = await submit(command);
      request.current = null;
      setFeedback(result.ok ? "saved" : result.error);
      if (result.ok && nextRole === null) {
        if (memberId === userId) setRole("base");
        requestAnimationFrame(() =>
          form.current?.querySelector<HTMLElement>("[role=combobox]")?.focus(),
        );
      }
    } catch {
      setFeedback("transport");
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-label={t.heading}
      aria-busy={pending}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">{t.heading}</h2>
      {site.canConfigure && (
        <>
          <p className="text-sm text-muted-foreground">{t.instructions}</p>
          <form
            ref={form}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSet) void save(userId, role);
            }}
          >
            <div className="w-full max-w-56">
              <EditorSelect
                label={t.staff}
                value={userId}
                options={[
                  { value: "", label: t.chooseStaff },
                  ...eligible.map(({ id, name }) => ({ value: id, label: name })),
                ]}
                onChange={(value) => {
                  setUserId(value);
                  setRole(members.find((member) => member.userId === value)?.role ?? "base");
                }}
                disabled={pending}
              />
            </div>
            <div className="w-full max-w-48">
              <EditorSelect
                label={t.role}
                value={role}
                options={[
                  { value: "base", label: t.base },
                  { value: "self_service", label: t.self_service },
                ]}
                onChange={(value) => setRole(value === "self_service" ? "self_service" : "base")}
                disabled={pending}
              />
            </div>
            <Button type="submit" size="sm" disabled={pending || !canSet}>
              {t.set}
            </Button>
          </form>
        </>
      )}
      {feedback === "freshAuth" ? (
        <IdentityActionError message="fresh_auth_required" />
      ) : feedback !== null ? (
        <p
          role={feedback === "saved" ? "status" : "alert"}
          className={
            feedback === "saved" ? "text-sm text-muted-foreground" : "text-sm text-destructive"
          }
        >
          {t[feedback]}
        </p>
      ) : null}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((member) => {
            const name = names.get(member.userId) ?? t.unknown;
            return (
              <li
                key={member.userId}
                data-booking-membership={member.userId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <bdi className="font-medium">{name}</bdi>
                  <p className="text-xs text-muted-foreground">{t[member.role]}</p>
                </div>
                {site.canConfigure && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={t.revokeFor.replace("{name}", () => name)}
                    disabled={pending}
                    onClick={() => void save(member.userId, null)}
                  >
                    {t.revoke}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
