import { findSharedBlock } from "@/features/blocks/catalog";
import type { WorkflowV2Adapters } from "@/features/blocks/contracts";
import { executeExternalAction } from "./externalActions";
import { externalActionReadiness } from "./externalReadiness";
import { executeNativeAction, nativeActionNode, nativeActionReadiness } from "./nativeActions";
import { pureBlockReadiness } from "./readiness";

export function createWorkflowV2Adapters(): WorkflowV2Adapters {
  return {
    native: executeNativeAction,
    external: executeExternalAction,
    readiness: async (db, actor, node, signal) => {
      if (nativeActionNode(node.type)) return nativeActionReadiness(db, actor, node, signal);
      const effect = findSharedBlock(node.type)?.effect;
      return effect === "pure" || effect === "wait"
        ? pureBlockReadiness(node)
        : externalActionReadiness(db, actor, node, signal);
    },
  };
}
