import { type ActivityTemporalRecord, activityParts } from "@/features/activities/activityTemporal";
import {
  composeDueAt,
  composeDueAtIso,
  deriveDurationMinutes,
} from "@/features/activities/activityTime";
import { isBlankHtml } from "@/features/activities/isBlankHtml";
import { addCivilDays, civilDateRange, instantCivilDate } from "@/lib/zonedDateTime";
import type { LinkKind, LinkTarget, LinkValue } from "./LinkChips";

// Draft state the composer submits; kept here so ActivityComposerInline stays under the file cap.
export interface ActivityDraft {
  typeId: string;
  subject: string;
  priority: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  links: LinkValue;
  leadId: string | null;
  location: string;
  note: string;
  videoCallUrl: string;
  done: boolean;
  ownerId: string;
  participants: string[];
}

// Input projection in the frozen draft zone; canonical all-day dates never shift.
export function localPartsFromIso(
  iso: string | null,
  allDay = false,
  timeZone = "UTC",
  dueDate?: string | null,
): { date: string; time: string } {
  const { date, time } = activityParts({ dueAtIso: iso, allDay, dueDate }, timeZone);
  return { date, time };
}

export function composedTemporal(
  d: Pick<ActivityDraft, "startDate" | "startTime" | "endDate" | "endTime">,
  timeZone = "UTC",
) {
  const { iso, allDay, dueDate } = composeDueAt(d.startDate, d.startTime, timeZone);
  const endAt =
    d.endDate === "" ? null : composeDueAtIso(d.endDate, allDay ? "" : d.endTime, timeZone);
  const sameDayEnd =
    endAt ??
    (d.endTime === "" || allDay ? null : composeDueAtIso(d.startDate, d.endTime, timeZone));
  const elapsed = iso && sameDayEnd ? (Date.parse(sameDayEnd) - Date.parse(iso)) / 60000 : 0;
  return {
    dueAt: iso,
    allDay,
    dueDate,
    endAt,
    endDate: allDay && endAt ? d.endDate : null,
    durationMinutes: elapsed > 0 ? elapsed : deriveDurationMinutes(d.startTime, d.endTime),
  };
}

function temporalUpdate(
  d: ActivityDraft,
  stored: Partial<ActivityTemporalRecord>,
  timeZone: string,
) {
  const temporal = composedTemporal(d, timeZone);
  if (stored.allDay === undefined) return temporal;
  const start = activityParts({ ...stored, allDay: stored.allDay }, timeZone);
  const end = localPartsFromIso(
    stored.endAt == null
      ? null
      : (stored.endAt instanceof Date ? stored.endAt : new Date(stored.endAt)).toISOString(),
    stored.allDay,
    timeZone,
    stored.endDate,
  );
  const startChanged = d.startDate !== start.date || d.startTime !== start.time;
  const endChanged = d.endDate !== end.date || d.endTime !== end.time;
  return {
    ...(startChanged
      ? {
          dueAt: temporal.dueAt,
          allDay: temporal.allDay,
          dueDate: temporal.dueDate,
          ...(!temporal.allDay ? { endDate: null } : {}),
        }
      : {}),
    ...(endChanged
      ? {
          ...(temporal.allDay && !stored.dueDate ? { dueDate: d.startDate } : {}),
          endAt: temporal.endAt,
          endDate: temporal.endDate,
          durationMinutes: temporal.durationMinutes,
        }
      : {}),
  };
}

// Map the composer draft to an activityUpdateInput patch for an existing activity. Mirrors
// buildActivityInput but carries the id and the update-shaped fields (the composer's participants
// are person guests -> guestPersonIds, matching create; participantUserIds is not edited here).
type StoredLinks = Pick<OwnLinks, "dealId" | "personId" | "orgId">;

function changedLinks(links: LinkValue, stored: StoredLinks) {
  return {
    ...(links.deal === stored.dealId ? {} : { dealId: links.deal }),
    ...(links.person === stored.personId ? {} : { personId: links.person }),
    ...(links.org === stored.orgId ? {} : { orgId: links.org }),
  };
}

export function buildActivityUpdateInput(
  id: string,
  d: ActivityDraft,
  stored: StoredLinks & Partial<ActivityTemporalRecord>,
  timeZone = "UTC",
) {
  return {
    id,
    typeId: d.typeId,
    subject: d.subject.trim(),
    priority: d.priority === "" ? null : d.priority,
    ...temporalUpdate(d, stored, timeZone),
    ...changedLinks(d.links, stored),
    location: d.location.trim() === "" ? null : d.location.trim(),
    note: isBlankHtml(d.note) ? null : d.note,
    videoCallUrl: d.videoCallUrl === "" ? null : d.videoCallUrl,
    assigneeId: d.ownerId === "" ? undefined : d.ownerId,
    guestPersonIds: d.participants,
  };
}

// Map the composer draft to the createActivityAction input (nullish/trim normalization in one place).
export function buildActivityInput(d: ActivityDraft, timeZone = "UTC") {
  return {
    typeId: d.typeId,
    subject: d.subject.trim(),
    priority: d.priority === "" ? null : d.priority,
    ...composedTemporal(d, timeZone),
    dealId: d.links.deal,
    leadId: d.leadId,
    personId: d.links.person,
    orgId: d.links.org,
    location: d.location.trim() === "" ? null : d.location.trim(),
    note: isBlankHtml(d.note) ? null : d.note,
    videoCallUrl: d.videoCallUrl === "" ? null : d.videoCallUrl,
    done: d.done,
    assigneeId: d.ownerId === "" ? undefined : d.ownerId,
    guestPersonIds: d.participants,
    participantUserIds: [] as string[],
    customFields: {},
  };
}

// The [from, to] window the Free/Busy availability query should cover for the current composer draft.
// `to` uses the end date + time when a multi-day end is set; for a same-day draft it uses the start
// date + the end TIME (so a 10:00-11:00 draft checks the whole hour, not just the 10:00 instant);
// with no end time it collapses to the start instant.
export function availabilityWindow(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
  timeZone = "UTC",
): { from: string | null; to: string | null } {
  if (startDate && startTime === "") {
    const range = civilDateRange(startDate, addCivilDays(endDate || startDate, 1), timeZone);
    return { from: range.from.toISOString(), to: range.to.toISOString() };
  }
  const from = composeDueAtIso(startDate, startTime, timeZone);
  const to =
    endDate !== ""
      ? composeDueAtIso(endDate, endTime, timeZone)
      : endTime !== ""
        ? composeDueAtIso(startDate, endTime, timeZone)
        : from;
  return { from, to };
}

// Local YYYY-MM-DD for the Start date default. Built from local date parts (not
// toISOString, which is UTC and can land on the wrong calendar day for the user).
export function todayLocalDateString(timeZone = "UTC", now = new Date()): string {
  return instantCivilDate(now, timeZone);
}

const LINK_FALLBACK: Record<LinkKind, string> = {
  deal: "Deal",
  person: "Person",
  org: "Organization",
};

// Build the removable link chips from the composer's deal context (only non-null links).
export function buildLinkTargets(
  dealId: string | null,
  personId: string | null,
  orgId: string | null,
  labels: { deal?: string; person?: string; org?: string },
): LinkTarget[] {
  const targets: LinkTarget[] = [];
  if (dealId !== null)
    targets.push({ kind: "deal", id: dealId, label: labels.deal ?? LINK_FALLBACK.deal });
  if (personId !== null)
    targets.push({ kind: "person", id: personId, label: labels.person ?? LINK_FALLBACK.person });
  if (orgId !== null)
    targets.push({ kind: "org", id: orgId, label: labels.org ?? LINK_FALLBACK.org });
  return targets;
}

interface OwnLinks {
  dealId: string | null;
  personId: string | null;
  orgId: string | null;
  dealTitle: string | null;
  personName: string | null;
  orgName: string | null;
}

interface PageLinkContext {
  dealId: string | null;
  personId: string | null;
  orgId: string | null;
  dealTitle?: string;
  personName?: string;
  orgName?: string;
}

function editTarget(
  kind: LinkKind,
  ownId: string | null,
  ownName: string | null,
  pageId: string | null,
  pageLabel?: string,
): LinkTarget | null {
  if (ownId !== null) return ownName === null ? null : { kind, id: ownId, label: ownName };
  if (pageId === null) return null;
  return { kind, id: pageId, label: pageLabel ?? LINK_FALLBACK[kind] };
}

export function buildEditLinkTargets(own: OwnLinks, page: PageLinkContext): LinkTarget[] {
  return [
    editTarget("deal", own.dealId, own.dealTitle, page.dealId, page.dealTitle),
    editTarget("person", own.personId, own.personName, page.personId, page.personName),
    editTarget("org", own.orgId, own.orgName, page.orgId, page.orgName),
  ].filter((t): t is LinkTarget => t !== null);
}
