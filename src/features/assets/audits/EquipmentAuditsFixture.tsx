"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { lookupFixtureEquipment } from "../bookings/handover/fixtureLookup";
import type { EquipmentAuditAccess } from "./contracts";
import {
  type AuditFixtureRole,
  auditFixtureData,
  auditFixtureParticipants,
  changeLiveAuditDemoEquipment,
} from "./fixtureData";
import { auditFixturePhotoFingerprint } from "./fixturePhoto";
import { lookupAuditEquipment, projectAuditDetail, projectAuditWorkspace } from "./projection";
import { type AuditFixtureActor, createAuditFixtureState } from "./state";
import { applyAuditCommand, attachAuditPhoto } from "./transitions";
import { EquipmentAuditsWorkspace } from "./ui/EquipmentAuditsWorkspace";

const words = {
  en: {
    role: "Demo role",
    manager: "Manager",
    mara: "Auditor Mara",
    elias: "Auditor Elias",
    unassigned: "Unassigned auditor",
    drift: "Change live demo equipment",
    changed: "The live equipment and balance changed.",
  },
  de: {
    role: "Demo-Rolle",
    manager: "Verwaltung",
    mara: "Prüferin Mara",
    elias: "Prüfer Elias",
    unassigned: "Nicht zugeteilte Prüferin",
    drift: "Live-Demo-Ausrüstung ändern",
    changed: "Die Live-Ausrüstung und ihr Bestand wurden geändert.",
  },
  fa: {
    role: "نقش نمایشی",
    manager: "مدیر",
    mara: "بازرس مارا",
    elias: "بازرس الیاس",
    unassigned: "بازرس تعیین‌نشده",
    drift: "تغییر تجهیزات زنده نمایشی",
    changed: "تجهیزات زنده و موجودی آن تغییر کردند.",
  },
} as const;

const roles = ["manager", "mara", "elias", "unassigned"] as const;
const denied = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;

function activeActor(
  actor: { id: string; name: string },
  privileged: boolean,
  role: AuditFixtureRole,
  data: ReturnType<typeof auditFixtureData>,
): AuditFixtureActor {
  if (privileged && role === "manager") {
    return {
      ...actor,
      roles: Object.fromEntries(data.assets.sites.map(({ id }) => [id, "manager"] as const)),
    };
  }
  const person = privileged && role !== "manager" ? auditFixtureParticipants[role] : actor;
  return {
    ...person,
    roles: { [data.siteId]: role === "elias" ? "self_service" : "base" },
  };
}

function beginDemo(
  data: ReturnType<typeof auditFixtureData>,
  actor: AuditFixtureActor,
  now: string,
  manager: boolean,
) {
  const empty = createAuditFixtureState(data.assets, data.roster);
  if (!manager) return empty;
  const ids = [
    "4936a1c4-c439-4fa8-817e-79b04281be31",
    "f8fd1b3b-57c1-415b-88d2-6f3bbe926bef",
    "c687642c-c93d-4972-8384-8d97fdc156fc",
  ];
  let ordinal = 0;
  const seeded = applyAuditCommand(
    empty,
    actor,
    {
      type: "create",
      requestId: "fc01e4bb-20f2-4a80-a539-f75cb70d4faf",
      siteId: data.siteId,
      title: "Instrument corner audit",
      dueAt: null,
      scope: data.scope,
      assigneeIds: [auditFixtureParticipants.mara.id],
    },
    {
      now,
      makeId: () => ids[ordinal++] ?? "dba2243e-c2be-4768-b22c-abbed8c0a386",
      resolve: () => null,
    },
  );
  return seeded.ok ? seeded.state : empty;
}

function selectionData(
  actor: AuditFixtureActor,
  assets: ReturnType<typeof auditFixtureData>["assets"],
) {
  return (siteId: string, code: string) => {
    const resolved = lookupFixtureEquipment(assets, siteId, actor.id, window.location.origin, code);
    return resolved.ok ? { kind: resolved.kind, id: resolved.id } : null;
  };
}

export function EquipmentAuditsFixture({
  actor,
  manager,
  initialNow,
  initialAuditId,
}: {
  actor: { id: string; name: string };
  manager: boolean;
  initialNow: string;
  initialAuditId?: string;
}) {
  const t = words[useLocale()];
  const [data] = useState(auditFixtureData);
  const [role, setRole] = useState<AuditFixtureRole>("manager");
  const [initial] = useState(() =>
    beginDemo(data, activeActor(actor, manager, "manager", data), initialNow, manager),
  );
  const state = useRef(initial);
  const [workspace, setWorkspace] = useState(() =>
    projectAuditWorkspace(initial, activeActor(actor, manager, "manager", data)),
  );
  const roleRef = useRef(role);
  const blobs = useRef(new Set<string>());
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const activeBlobs = blobs.current;
    return () => {
      for (const href of activeBlobs) URL.revokeObjectURL(href);
      activeBlobs.clear();
    };
  }, []);

  const currentActor = useMemo(
    () => activeActor(actor, manager, role, data),
    [actor, manager, role, data],
  );
  const access = useMemo<EquipmentAuditAccess>(() => {
    const clock = () => ({
      now: new Date().toISOString(),
      makeId: () => crypto.randomUUID(),
      resolve: selectionData(currentActor, state.current.assets),
    });
    return {
      read: (id) => Promise.resolve(projectAuditDetail(state.current, currentActor, id)),
      submit(input) {
        if (roleRef.current !== role) return Promise.resolve(denied);
        const result = applyAuditCommand(state.current, currentActor, input, clock());
        if (!result.ok) return Promise.resolve(result);
        state.current = result.state;
        return Promise.resolve({ ok: true, workspace: result.workspace, detail: result.detail });
      },
      lookup: (id, code) =>
        Promise.resolve(
          lookupAuditEquipment(
            state.current,
            currentActor,
            id,
            code,
            selectionData(currentActor, state.current.assets),
          ),
        ),
      async attach({ file, ...input }) {
        const readable = projectAuditDetail(state.current, currentActor, input.auditId);
        if (!readable.ok || !readable.value.canCount) return denied;
        const fingerprint = await auditFixturePhotoFingerprint(file);
        if (roleRef.current !== role) return denied;
        if (fingerprint === null) return invalid;
        const href = URL.createObjectURL(file);
        const result = attachAuditPhoto(
          state.current,
          currentActor,
          { ...input, name: file.name, fingerprint, href },
          clock(),
        );
        if (result.ok && result.applied) blobs.current.add(href);
        else URL.revokeObjectURL(href);
        if (!result.ok) return result;
        state.current = result.state;
        return { ok: true, workspace: result.workspace, detail: result.detail };
      },
    };
  }, [currentActor, role]);

  function preview(next: AuditFixtureRole) {
    roleRef.current = next;
    setRole(next);
    setWorkspace(projectAuditWorkspace(state.current, activeActor(actor, manager, next, data)));
  }

  function changeLiveAssets() {
    state.current = {
      ...state.current,
      assets: changeLiveAuditDemoEquipment(state.current.assets),
    };
    setChanged(true);
  }

  return (
    <>
      {manager && (
        <fieldset className="mx-4 mt-4 flex flex-wrap items-center gap-2 sm:mx-6">
          <legend className="mb-1 text-sm text-muted-foreground">{t.role}</legend>
          {roles.map((next) => (
            <Button
              key={next}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={role === next}
              onClick={() => preview(next)}
            >
              {t[next]}
            </Button>
          ))}
          {role === "manager" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={changed}
              onClick={changeLiveAssets}
            >
              {t.drift}
            </Button>
          )}
          {changed && (
            <span role="status" className="text-xs text-muted-foreground">
              {t.changed}
            </span>
          )}
        </fieldset>
      )}
      <EquipmentAuditsWorkspace
        key={role}
        initial={workspace}
        access={access}
        fixture
        initialAuditId={initialAuditId}
        canBrowseAssets={manager && role === "manager"}
      />
    </>
  );
}
