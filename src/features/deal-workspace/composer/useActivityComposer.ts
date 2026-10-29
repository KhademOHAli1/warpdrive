"use client";
import { useState } from "react";
import { createActivityAction, editActivityAction } from "@/features/activities/actions";
import { localizeActivityTypes } from "@/features/activities/activityTypeLabels";
import type { EditableActivity } from "@/features/activities/getForEdit";
import { useInvalidateActivityLists } from "@/features/activities/useInvalidateActivityLists";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  buildActivityInput,
  buildActivityUpdateInput,
  buildEditLinkTargets,
  buildLinkTargets,
  localPartsFromIso,
  todayLocalDateString,
} from "./composerHelpers";
import type { LinkKind, LinkValue } from "./LinkChips";
import { buildParticipantOptions } from "./participantOptions";
import { useComposerAvailability } from "./useComposerAvailability";

export interface ActivityComposerProps {
  // Exactly one of dealId/leadId is set (mirrors the activities table's deal-XOR-lead constraint).
  dealId: string | null;
  leadId?: string | null;
  personId: string | null;
  orgId: string | null;
  personName?: string;
  dealTitle?: string;
  orgName?: string;
  // Called after a successful create OR save; the caller collapses/refreshes.
  onCreated: () => void;
  // When set the composer is in EDIT mode: fields seed from this activity and Save calls the update
  // action instead of create. Absent = create mode.
  editing?: EditableActivity | null;
}

// All state, derived values, and the submit/duplicate handlers for the activity composer. Extracted
// from ActivityComposerInline so the component stays under the file cap and the create-vs-edit
// seeding + submit branching live in one place. Returns flat value/setter pairs consumed by the JSX.
export function useActivityComposer(props: ActivityComposerProps) {
  const preferences = useLocalePreferences();
  const [draftZone] = useState(preferences.timeZone);
  const tCalendar = useAppTranslations("calendar");
  const translateSales = useAppTranslations("sales");
  const { dealId, leadId, personId, orgId, personName, dealTitle, orgName, onCreated } = props;
  const editing = props.editing ?? null;

  const invalidateActivityLists = useInvalidateActivityLists();
  const types = localizeActivityTypes(
    trpc.activities.listTypes.useQuery().data ?? [],
    preferences.locale,
  );
  const owners = trpc.identity.assignableUsers.useQuery().data ?? [];
  const orgPeople = trpc.contacts.listPeopleForOrg.useQuery(
    { orgId: orgId ?? "" },
    { enabled: orgId !== null },
  );
  // Participants candidate source: the deal's contact person is always offered (and pre-selected),
  // merged with the org's contacts. See buildParticipantOptions for why org membership isn't enough.
  const participantOptions = buildParticipantOptions(
    orgId !== null ? (orgPeople.data ?? []) : [],
    personId,
    personName,
    translateSales("computed.dealContact"),
  );

  const start = localPartsFromIso(
    editing?.dueAt ?? null,
    editing?.allDay ?? false,
    draftZone,
    editing?.dueDate,
  );
  const end = localPartsFromIso(
    editing?.endAt ?? null,
    editing?.allDay ?? false,
    draftZone,
    editing?.endDate,
  );

  const [typeId, setTypeId] = useState(editing?.typeId ?? "");
  const [subject, setSubject] = useState(editing?.subject ?? "");
  // subjectEdited stops the type-name prefill ("Call" -> subject "Call") once the user types; it
  // starts locked in edit mode since the stored subject is already the user's own text.
  const [subjectEdited, setSubjectEdited] = useState(editing !== null);
  const [priority, setPriority] = useState(editing?.priority ?? "");
  const [startDate, setStartDate] = useState(
    editing !== null ? start.date : todayLocalDateString(draftZone),
  );
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [endDate, setEndDate] = useState(end.date);
  const [location, setLocation] = useState(editing?.location ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [videoCallUrl, setVideoCallUrl] = useState(editing?.videoCallUrl ?? "");
  const [ownerId, setOwnerId] = useState(editing?.assigneeId ?? "");
  const [participants, setParticipants] = useState<string[]>(
    editing !== null ? editing.guestPersonIds : personId !== null ? [personId] : [],
  );
  const [links, setLinks] = useState<LinkValue>(
    editing !== null
      ? { deal: editing.dealId, person: editing.personId, org: editing.orgId }
      : { deal: dealId, person: personId, org: orgId },
  );
  const [done, setDone] = useState(editing?.done ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const linkLabels = {
    deal: dealTitle ?? translateSales("computed.deal"),
    person: personName ?? translateSales("computed.person"),
    org: orgName ?? translateSales("computed.organization"),
  };
  const pageLinks = {
    dealId,
    personId,
    orgId,
    dealTitle: linkLabels.deal,
    personName: linkLabels.person,
    orgName: linkLabels.org,
  };
  const linkTargets =
    editing === null
      ? buildLinkTargets(dealId, personId, orgId, {
          deal: linkLabels.deal,
          person: linkLabels.person,
          org: linkLabels.org,
        })
      : buildEditLinkTargets(editing, pageLinks);
  function setLink(kind: LinkKind, id: string | null): void {
    setLinks((prev) => ({ ...prev, [kind]: id }));
  }

  const busy = useComposerAvailability({
    ownerId,
    startDate,
    startTime,
    endDate,
    endTime,
    timeZone: draftZone,
  });

  const effectiveTypeId = typeId === "" ? (types[0]?.id ?? "") : typeId;
  const typeName = types.find((t) => t.id === effectiveTypeId)?.name ?? "";
  const subjectValue = subjectEdited ? subject : subject === "" ? typeName : subject;

  function draft() {
    return {
      typeId: effectiveTypeId,
      subject: subjectValue,
      priority,
      startDate,
      startTime,
      endDate,
      endTime,
      links,
      leadId: leadId ?? null,
      location,
      note,
      videoCallUrl,
      done,
      ownerId,
      participants,
    };
  }

  // After a create, clear back to the deal-context defaults for the next activity. Edit mode never
  // resets (the caller closes the composer instead).
  function resetForNext(): void {
    setSubject("");
    setSubjectEdited(false);
    setNote("");
    setLocation("");
    setStartDate(todayLocalDateString(draftZone));
    setStartTime("");
    setEndTime("");
    setEndDate("");
    setVideoCallUrl("");
    setPriority("");
    setOwnerId("");
    setParticipants(personId !== null ? [personId] : []);
    setLinks({ deal: dealId, person: personId, org: orgId });
    setDone(false);
  }

  async function submit(): Promise<void> {
    if (subjectValue.trim() === "") {
      setError(translateSales("computed.subjectRequired"));
      return;
    }
    if (effectiveTypeId === "") {
      setError(translateSales("computed.activityTypeUnavailable"));
      return;
    }
    if (startDate.trim() === "") {
      setError(translateSales("computed.dateRequired"));
      return;
    }
    setPending(true);
    setError(null);
    const csrf = readCsrfToken();
    let createInput: ReturnType<typeof buildActivityInput> | undefined;
    let editInput: ReturnType<typeof buildActivityUpdateInput> | undefined;
    try {
      if (editing) editInput = buildActivityUpdateInput(editing.id, draft(), editing, draftZone);
      else createInput = buildActivityInput(draft(), draftZone);
    } catch {
      setPending(false);
      setError(tCalendar("invalidWallTime"));
      return;
    }
    const r = editInput
      ? await editActivityAction(editInput, csrf)
      : await createActivityAction(createInput!, csrf);
    if (!r.ok) {
      setPending(false);
      setError(
        translateSales(
          editing !== null ? "computed.saveActivityFailed" : "computed.createActivityFailed",
          { id: r.error.id },
        ),
      );
      return;
    }
    await invalidateActivityLists();
    setPending(false);
    if (editing === null) resetForNext();
    onCreated();
  }

  // Duplicate (Pipedrive parity): keep the current field values but start a fresh draft; the subject
  // is locked (subjectEdited) so it survives a later type change, and done resets.
  function duplicate(): void {
    setSubject(subjectValue);
    setSubjectEdited(true);
    setDone(false);
    setError(null);
  }

  return {
    draftZone,
    legacyAllDay: !!editing?.allDay && !editing?.dueDate,
    types,
    owners,
    participantOptions,
    linkTargets,
    subjectValue,
    setSubject,
    setSubjectEdited,
    effectiveTypeId,
    setTypeId,
    startDate,
    setStartDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    endDate,
    setEndDate,
    busy,
    priority,
    setPriority,
    participants,
    setParticipants,
    location,
    setLocation,
    videoCallUrl,
    setVideoCallUrl,
    note,
    setNote,
    ownerId,
    setOwnerId,
    links,
    setLink,
    error,
    done,
    setDone,
    pending,
    submit,
    duplicate,
  };
}
