import type { CoreEnvironment } from "@/config/coreEnv";
import { coreDatabaseRole } from "@/db/corePoolProfile";
import { runtimeQueueOptions } from "./schemaContract";

export function coreProducerOptions(connectionString: string, profile: CoreEnvironment) {
  coreDatabaseRole(connectionString);
  return {
    ...runtimeQueueOptions("app"),
    connectionString,
    application_name: "warpdrive-core-producer",
    max: profile.CORE_PRODUCER_DB_MAX,
    useListenNotify: false,
  };
}
