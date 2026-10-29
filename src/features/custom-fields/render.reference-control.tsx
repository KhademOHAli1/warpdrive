"use client";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ControlProps } from "./render.widget-types";
import { strVal } from "./render.widget-types";
export function ReferenceControl({ def, value, onChange }: ControlProps) {
  const t = useAppTranslations("customFields");
  const usersQ = trpc.identity.assignableUsers.useQuery(undefined, {
    enabled: def.type === "user",
    retry: false,
  });
  const peopleQ = trpc.contacts.personOptions.useQuery(undefined, {
    enabled: def.type === "person",
    retry: false,
  });
  const orgsQ = trpc.contacts.orgOptions.useQuery(undefined, {
    enabled: def.type === "org",
    retry: false,
  });

  let options: ComboboxOption[] = [];
  let loading = false;
  if (def.type === "user") {
    loading = usersQ.isLoading;
    options = (usersQ.data ?? []).map((option) => ({
      value: option.id,
      label: option.name,
      avatarName: option.name,
      avatarUrl: option.avatarUrl,
    }));
  } else if (def.type === "person") {
    loading = peopleQ.isLoading;
    options = (peopleQ.data ?? []).map((option) => ({ value: option.id, label: option.name }));
  } else {
    loading = orgsQ.isLoading;
    options = (orgsQ.data ?? []).map((option) => ({ value: option.id, label: option.name }));
  }

  const unavailable =
    def.type === "user" ? usersQ.isError : def.type === "person" ? peopleQ.isError : orgsQ.isError;
  return (
    <div>
      <Combobox
        ariaLabel={def.name}
        value={strVal(value)}
        onChange={onChange}
        placeholder={
          loading
            ? t("loading")
            : t(
                def.type === "user"
                  ? "selectUser"
                  : def.type === "person"
                    ? "selectPerson"
                    : "selectOrg",
              )
        }
        options={[{ value: "", label: t("none") }, ...options]}
      />
      {unavailable && (
        <p role="alert" className="text-xs text-destructive">
          {t("referenceUnavailable", { name: def.name })}
        </p>
      )}
    </div>
  );
}
