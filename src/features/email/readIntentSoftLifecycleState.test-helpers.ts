import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { prepareThreadReadIntent } from "./readIntentLifecycle";
import type { SoftMailbox } from "./readIntentSoftLifecycleConnection.test-helpers";
import { softSignal } from "./readIntentSoftLifecycleConnection.test-helpers";
import {
  admitReadIntent,
  cancelPreparedReadIntent,
  denyPreparedReadIntent,
  finishReadIntent,
  loadReadIntent,
} from "./readIntentStore";
import type { ReadIntentState } from "./readIntentTypes";

export const SOFT_READ_STATES = [
  "prepared",
  "applied",
  "denied",
  "cancelled",
  "admitted",
  "unknown",
] as const satisfies readonly ReadIntentState[];

// Legal state fixtures exercise the real store/trigger transitions. They do not claim
// that a provider write or an acknowledgement loss occurred while arranging the state.
export async function prepareSoftState(db: Db, f: SoftMailbox, state: ReadIntentState) {
  const prepared = await prepareThreadReadIntent(
    db,
    { actor: f.actor, session: f.context, threadId: f.threadId, read: true },
    softSignal(),
  );
  expect(prepared).toMatchObject({ ok: true, value: { kind: "created" } });
  if (!prepared.ok) throw prepared.error;
  const operationId = prepared.value.readIntent.operationId;
  const key = { actorId: f.actor.id, threadId: f.threadId, operationId };
  if (state !== "prepared") {
    await db.transaction(async (tx) => {
      if (state === "denied") {
        expect(
          await denyPreparedReadIntent(tx, key, ERROR_IDS.MAIL_CAPABILITY_DENIED, softSignal()),
        ).toMatchObject({ state });
      } else if (state === "cancelled") {
        expect(await cancelPreparedReadIntent(tx, key, softSignal())).toMatchObject({ state });
      } else {
        const claim = randomUUID();
        expect(await admitReadIntent(tx, key, claim, softSignal())).toMatchObject({
          state: "admitted",
        });
        if (state === "applied") {
          expect(await finishReadIntent(tx, key, claim, { state }, softSignal())).toMatchObject({
            state,
          });
        } else if (state === "unknown") {
          expect(
            await finishReadIntent(
              tx,
              key,
              claim,
              { state, errorId: ERROR_IDS.MAIL_WRITE_UNKNOWN },
              softSignal(),
            ),
          ).toMatchObject({ state });
        }
      }
    });
  }
  const stored = await loadReadIntent(db, key, softSignal());
  expect(stored).toMatchObject({ operationId, state });
  if (state === "applied" || state === "admitted" || state === "unknown")
    expect(stored?.dispatchClaim).toEqual(expect.any(String));
  else expect(stored?.dispatchClaim).toBeNull();
  return { state, operationId };
}

export type SoftReadOperation = Awaited<ReturnType<typeof prepareSoftState>>;
