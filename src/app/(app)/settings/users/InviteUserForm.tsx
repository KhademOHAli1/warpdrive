"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { ERROR_IDS } from "@/constants/errorIds";
import { managementMessagesForLocale } from "@/features/auth/management/messages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { inviteUserAction } from "@/features/identity/actions/invite";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { isValidEmail } from "@/lib/isValidEmail";
import { readCsrfToken } from "@/utils/csrfCookie";

interface FieldErrors {
  email: string | null;
  name: string | null;
}

const NO_FIELD_ERRORS: FieldErrors = { email: null, name: null };

interface Props {
  onInvited: () => void;
  viewerIsAdmin?: boolean;
}

export function InviteUserForm({ onInvited, viewerIsAdmin = false }: Props): React.ReactElement {
  const L = useSettingsMessages();
  const M = managementMessagesForLocale(useLocale());

  const MESSAGES: Record<string, string> = {
    [ERROR_IDS.AUTH_EMAIL_TAKEN]: L._extra.that_email_is_already_registered,
    [ERROR_IDS.PERM_DENIED]: L._extra.you_do_not_have_permission_to_invite_users,
    [ERROR_IDS.AUTH_INVITE_INPUT_INVALID]: L._extra.enter_a_valid_email_and_name,
    [ERROR_IDS.AUTH_POLICY_DENIED]: L._errors.freshAuthentication,
  };

  const T = {
    emailMissing: L._extra.enter_an_email_address,
    emailInvalid: L._extra.enter_a_valid_email_address,
    nameMissing: L._extra.enter_a_name,
    emailLabel: L._extra.email,
    emailPlaceholder: "person@example.com",
    nameLabel: L._extra.name,
    namePlaceholder: L._extra.full_name,
    admin: L._extra.admin,
    invite: L._extra.invite,
    inviting: L._extra.inviting,
  } as const;

  function inviteErrorMessage(id: string): string {
    return MESSAGES[id] ?? L._errors.generic;
  }
  function validate(email: string, name: string): FieldErrors {
    return {
      email: email.length === 0 ? T.emailMissing : isValidEmail(email) ? null : T.emailInvalid,
      name: name.length === 0 ? T.nameMissing : null,
    };
  }

  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Per-field validation, shown inline instead of the browser's own validation bubble.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);
  // Delivery status is tracked without exposing the invitation bearer credential.
  const [invited, setInvited] = useState<{ name: string; email: string } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const email = emailRef.current?.value.trim() ?? "";
    const name = nameRef.current?.value.trim() ?? "";
    const invalid = validate(email, name);
    setFieldErrors(invalid);
    if (invalid.email !== null || invalid.name !== null) return;
    setError(null);
    const csrf = readCsrfToken();
    startTransition(async () => {
      const result = await inviteUserAction(csrf, { email, name, isAdmin });
      if (!result.ok) {
        setError(inviteErrorMessage(result.error.id));
        return;
      }
      if (emailRef.current !== null) emailRef.current.value = "";
      if (nameRef.current !== null) nameRef.current.value = "";
      setIsAdmin(false);
      setInvited({ name, email });
      onInvited();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="overflow-hidden rounded-lg border bg-card shadow-sm"
    >
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
          <UserPlus className="size-4" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{L._extra.invite_a_user}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {L._extra.add_a_teammate_and_choose_whether_they_can_manage_company_}
          </p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-email" className="text-sm font-medium">
              {T.emailLabel}
            </label>
            <Input
              ref={emailRef}
              id="invite-email"
              type="email"
              dir="ltr"
              required
              aria-invalid={fieldErrors.email !== null}
              aria-describedby={fieldErrors.email !== null ? "invite-email-error" : undefined}
              placeholder={T.emailPlaceholder}
              className="w-full px-3"
              disabled={isPending}
            />
            {fieldErrors.email !== null && (
              <p id="invite-email-error" role="alert" className="text-sm text-red-600">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-name" className="text-sm font-medium">
              {T.nameLabel}
            </label>
            <Input
              ref={nameRef}
              id="invite-name"
              type="text"
              required
              maxLength={120}
              aria-invalid={fieldErrors.name !== null}
              aria-describedby={fieldErrors.name !== null ? "invite-name-error" : undefined}
              placeholder={T.namePlaceholder}
              className="w-full px-3"
              disabled={isPending}
            />
            {fieldErrors.name !== null && (
              <p id="invite-name-error" role="alert" className="text-sm text-red-600">
                {fieldErrors.name}
              </p>
            )}
          </div>
        </div>
        {viewerIsAdmin && (
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={isAdmin} onCheckedChange={setIsAdmin} label={T.admin} />
            {T.admin}
          </span>
        )}
        {error !== null && <IdentityActionError message={error} className="text-sm text-red-600" />}
        {invited !== null && (
          <div role="status" className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p>{M.invitationQueued}</p>
            <p>
              <bdi dir="ltr">{invited.email}</bdi>
            </p>
            <Link href="/settings/security-admin" className="underline">
              {M.reviewInvitations}
            </Link>
          </div>
        )}
      </div>
      <div className="flex justify-end border-t bg-muted/20 px-5 py-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? T.inviting : T.invite}
        </Button>
      </div>
    </form>
  );
}
