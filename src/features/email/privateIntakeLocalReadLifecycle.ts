import type { PoolClient } from "pg";
import {
  type Backend,
  PRIVATE_READ_CLEANUP_MS,
  retirePrivateReadClient,
} from "./privateIntakeLocalReadConnection";

interface LifecycleState {
  released: boolean;
  destroyed: boolean;
  armed: boolean;
  retired: boolean;
  endedBeforeRetirement: boolean;
  transport: Error | undefined;
  failure: { error: unknown } | undefined;
  backend: Backend | undefined;
  begun: boolean;
  commitUncertain: boolean;
  cleanup: AbortSignal | undefined;
  closing: ReturnType<typeof retirePrivateReadClient> | undefined;
  workStarted: boolean;
  cleanupWork: Promise<unknown>;
}

export function ownPrivateReadLifecycle(client: PoolClient, signal: AbortSignal) {
  const state: LifecycleState = {
    released: false,
    destroyed: false,
    armed: true,
    retired: false,
    endedBeforeRetirement: false,
    transport: undefined,
    failure: undefined,
    backend: undefined,
    begun: false,
    commitUncertain: false,
    cleanup: undefined,
    closing: undefined,
    workStarted: false,
    cleanupWork: Promise.resolve(),
  };
  let completeWork = () => {};
  const workSettled = new Promise<void>((resolve) => {
    completeWork = resolve;
  });
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  let startedRetirement = () => {};
  const retirementStarted = new Promise<void>((resolve) => {
    startedRetirement = resolve;
  });
  const onError = (error: Error) => {
    if (!state.retired && state.transport === undefined) state.transport = error;
  };
  const onEnd = () => {
    state.endedBeforeRetirement = !state.retired;
    client.removeListener("error", onError);
    end();
  };
  const release = (destroy = false) => {
    if (!state.released) {
      state.released = true;
      state.destroyed = destroy;
      client.release(destroy);
    }
  };
  const destroy = () => {
    if (state.closing === undefined) {
      state.destroyed = true;
      state.closing = retirePrivateReadClient(
        client,
        ended,
        Promise.all([workSettled, state.cleanupWork]),
        () => release(true),
      );
    }
    return state.closing;
  };
  const onAbort = () => {
    if (
      !state.armed ||
      state.failure !== undefined ||
      state.transport !== undefined ||
      state.endedBeforeRetirement
    )
      return;
    state.retired = true;
    state.cleanup = AbortSignal.timeout(PRIVATE_READ_CLEANUP_MS);
    destroy();
    startedRetirement();
  };
  const disarm = () => {
    state.armed = false;
    signal.removeEventListener("abort", onAbort);
  };
  const arm = () => signal.addEventListener("abort", onAbort, { once: true });
  const detach = () => {
    client.removeListener("error", onError);
    client.removeListener("end", onEnd);
  };
  client.on("error", onError);
  client.once("end", onEnd);
  return {
    client,
    signal,
    state,
    completeWork,
    retirementStarted,
    release,
    destroy,
    disarm,
    arm,
    detach,
  };
}

export type PrivateReadLifecycle = ReturnType<typeof ownPrivateReadLifecycle>;
