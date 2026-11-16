import { cache } from "react";
import { coreClient } from "./trpc";
import { frontendIdentity } from "./version";

export const getBootstrap = cache(() => coreClient().frontend.bootstrap.query());
export const getFrontendConfig = cache(async () => {
  const configuration = await coreClient().frontend.configuration.query();
  const identity = frontendIdentity();
  return {
    ...configuration,
    APP_VERSION: identity.version,
    APP_COMMIT: identity.sourceRevision ?? "",
  };
});

/** Display-only authenticated projection. Backend requests always resolve their own authority. */
export const createContext = cache(async () => {
  const bootstrap = await getBootstrap();
  return {
    actor: bootstrap.actor,
    session: bootstrap.session,
    localeFallback: bootstrap.localeFallback,
    pendingAuthentication: bootstrap.pendingAuthentication,
  };
});

export type FrontendContext = Awaited<ReturnType<typeof createContext>>;
export type AppContext = FrontendContext;
