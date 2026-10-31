import { findSimilarOptions } from "@/features/entity-create/similarMatch";
import { comparePhoneInputs } from "@/utils/phoneMatching";
import type { PhoneCountry } from "@/utils/phoneNormalization";

// A visible person reduced to the fields the deal Person panel can match a typed draft against.
export interface PersonMatchOption {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
}

export interface PersonDraft {
  name: string;
  email: string;
  phone: string;
  phoneCountry?: PhoneCountry;
}

// Which typed field pointed at this person. Ordered strongest first: an email is an identity, a
// phone very nearly one, a name only a hint.
export type PersonMatchReason = "email" | "phone" | "name";

export interface PersonMatch {
  option: PersonMatchOption;
  reason: PersonMatchReason;
}

// Only a complete address is an identity claim; "steve" is still mid-typing.
function byEmail(email: string, options: PersonMatchOption[]): PersonMatchOption[] {
  const q = email.trim().toLowerCase();
  if (!q.includes("@")) return [];
  return options.filter((o) => o.emails.some((e) => e.trim().toLowerCase() === q));
}

// Every suggestion is reviewed by the user. Complete international identities
// compare exactly; country-less legacy suffixes remain review hints only.
function byPhone(
  phone: string,
  options: PersonMatchOption[],
  country?: PhoneCountry,
): PersonMatchOption[] {
  return options.filter((option) =>
    option.phones.some((stored) => comparePhoneInputs(phone, stored, country) !== "different"),
  );
}

// Reuses the Add deal/lead near-duplicate scan so the panel warns on the same spellings the create
// comboboxes already do.
function byName(name: string, options: PersonMatchOption[]): PersonMatchOption[] {
  const q = name.trim();
  if (q === "") return [];
  const similar = new Set(findSimilarOptions(options, q).map((o) => o.id));
  return options.filter((o) => similar.has(o.id));
}

// Existing people that the half-typed draft looks like, so the panel can offer to link one instead
// of creating a duplicate. Each person appears at most once, under its strongest signal.
export function findPersonMatches(draft: PersonDraft, options: PersonMatchOption[]): PersonMatch[] {
  const matches = new Map<string, PersonMatch>();
  const bySignal: Array<[PersonMatchReason, PersonMatchOption[]]> = [
    ["email", byEmail(draft.email, options)],
    ["phone", byPhone(draft.phone, options, draft.phoneCountry)],
    ["name", byName(draft.name, options)],
  ];
  for (const [reason, found] of bySignal) {
    for (const option of found) {
      if (!matches.has(option.id)) matches.set(option.id, { option, reason });
    }
  }
  return [...matches.values()];
}
