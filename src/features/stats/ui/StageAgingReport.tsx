import { trpc } from "@/lib/trpc-client";
import type { OwnerScope } from "@/types/stats";
import type { StageAgingView } from "../history/stageAgingView";
import { StageAgingPanel } from "./StageAgingPanel";

interface Scope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
}

export function StageAgingReport({ scope }: { scope: Scope }) {
  const query = trpc.stats.stageAging.useQuery(scope, {
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
    trpc: { abortOnUnmount: true },
  });

  let view: StageAgingView = { state: "loading" };
  if (
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isPaused &&
    !query.isPlaceholderData
  ) {
    if (query.isError) {
      const code = query.error.data?.code;
      view =
        code === "UNAUTHORIZED" || code === "FORBIDDEN"
          ? { state: "permission" }
          : { state: "unavailable", reason: "read" };
    } else {
      view = query.data ?? { state: "unavailable", reason: "read" };
    }
  }
  const ownOnly =
    view.state === "available" &&
    view.effectiveOwnerScope === "me" &&
    scope.ownerScope.kind !== "me";

  return (
    <StageAgingPanel
      view={view}
      ownOnly={ownOnly}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
