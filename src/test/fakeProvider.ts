import type {
  ProviderAdapter,
  ProviderOperation,
} from "@/features/integrations/providers/contract";
import { FakeProviderControl } from "./fakeProviderControl";
import type { FakeProviderConfig, FakeProviderFault } from "./fakeProviderModels";
import { approve, authorize, exchange, refresh } from "./fakeProviderOAuth";
import { check, disconnect, discoverCapabilities, listResources } from "./fakeProviderResources";
import { FakeProviderState } from "./fakeProviderState";

// Stateful unit/contract simulation only. No HTTP server, real credentials, DB, or background jobs.
export function createFakeProvider(config: FakeProviderConfig) {
  const state = new FakeProviderState(config);
  const control = new FakeProviderControl();
  const adapter: ProviderAdapter = {
    id: "synthetic-fixture",
    operations: {
      authorize: {
        mode: "supported",
        run: (input, signal) => control.invoke("authorize", signal, () => authorize(state, input)),
      },
      exchange: {
        mode: "supported",
        run: (input, signal) => control.invoke("exchange", signal, () => exchange(state, input)),
      },
      refresh: {
        mode: "supported",
        run: (input, signal) => control.invoke("refresh", signal, () => refresh(state, input)),
      },
      listResources: {
        mode: "supported",
        run: (input, signal) =>
          control.invoke("listResources", signal, () => listResources(state, input)),
      },
      check: {
        mode: "supported",
        run: (input, signal) => control.invoke("check", signal, () => check(state, input)),
      },
      disconnect: {
        mode: "supported",
        run: (input, signal) =>
          control.invoke("disconnect", signal, () => disconnect(state, input)),
      },
      discoverCapabilities: {
        mode: "supported",
        run: (input, signal) =>
          control.invoke("discoverCapabilities", signal, () => discoverCapabilities(state, input)),
      },
    },
  };
  return {
    adapter,
    approve: (attemptId: string, accountId: string, signal: AbortSignal) =>
      approve(state, attemptId, accountId, signal),
    bindCredential: (candidate: unknown) => state.bindCredential(candidate),
    advanceTime: (ms: number) => state.advanceTime(ms),
    failNext: (operation: ProviderOperation, fault: FakeProviderFault) =>
      control.failNext(operation, fault),
    holdNext: (operation: ProviderOperation) => control.holdNext(operation),
    calls: (operation: ProviderOperation) => control.calls(operation),
  };
}
