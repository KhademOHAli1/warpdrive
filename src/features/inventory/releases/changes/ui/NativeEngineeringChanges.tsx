"use client";

import { TRPCClientError } from "@trpc/client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ReleaseWorkspace } from "../../liveContracts";
import type { EngineeringChangeAccess, EngineeringChangeResult } from "../contracts";
import { executeEngineeringChangeAction } from "../webActions";
import { EngineeringChangePanel } from "./EngineeringChangePanel";

const unavailable = { ok: false, error: "unavailable" } as const;
type Props = {
  workspace: ReleaseWorkspace;
  refresh: () => Promise<unknown>;
};

async function scopedResult<T>(
  request: Promise<EngineeringChangeResult<T>>,
): Promise<EngineeringChangeResult<T>> {
  try {
    return await request;
  } catch (error) {
    const data: unknown = error instanceof TRPCClientError ? error.data : undefined;
    if (
      data !== null &&
      typeof data === "object" &&
      "code" in data &&
      (data.code === "UNAUTHORIZED" || data.code === "FORBIDDEN" || data.code === "NOT_FOUND")
    ) {
      return unavailable;
    }
    throw error;
  }
}

function ScopedNativeEngineeringChanges({
  actorId,
  workspace,
  refresh,
}: Props & { actorId: string }) {
  const { itemId, activeReleaseId } = workspace;
  const client = trpc.useUtils().client;
  const displayed = useRef({ activeReleaseId, refresh });
  const observedRelease = useRef(activeReleaseId);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    displayed.current = { activeReleaseId, refresh };
  }, [activeReleaseId, refresh]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const access = useMemo<EngineeringChangeAccess>(
    () => ({
      async read(target, signal) {
        if (target !== itemId) return unavailable;
        const result = await scopedResult(
          client.inventory.releases.changes.workspace.query({ itemId, actorId }, { signal }),
        );
        if (
          !result.ok ||
          result.value.itemId !== itemId ||
          signal?.aborted === true ||
          !mounted.current
        ) {
          return result;
        }
        const effective = result.value.effectiveRelease?.id ?? null;
        if (observedRelease.current !== effective) {
          observedRelease.current = effective;
          if (displayed.current.activeReleaseId !== effective) {
            void displayed.current.refresh().catch(() => undefined);
          }
        }
        return result;
      },
      preview(target, candidateReleaseId, signal) {
        if (target !== itemId) return Promise.resolve(unavailable);
        return scopedResult(
          client.inventory.releases.changes.review.query(
            { itemId, candidateReleaseId, actorId },
            { signal },
          ),
        );
      },
      async execute(input) {
        if (input.itemId !== itemId) return unavailable;
        const result = await executeEngineeringChangeAction(actorId, input, readCsrfToken());
        if (result.ok && result.value.itemId === itemId && mounted.current) {
          observedRelease.current = result.value.effectiveRelease?.id ?? null;
          void displayed.current.refresh().catch(() => undefined);
        }
        return result;
      },
    }),
    [actorId, client, itemId],
  );
  return <EngineeringChangePanel itemId={itemId} access={access} refreshKey={workspace} />;
}

export function NativeEngineeringChanges(props: Props) {
  const { actorId } = useNativeActor();
  if (actorId === null) return null;
  return <ScopedNativeEngineeringChanges key={actorId} actorId={actorId} {...props} />;
}
