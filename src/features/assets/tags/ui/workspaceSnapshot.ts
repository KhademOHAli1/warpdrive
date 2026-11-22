import type { AssetTagWorkspace } from "../contracts";

export function latestTagWorkspace(
  current: AssetTagWorkspace,
  incoming: AssetTagWorkspace,
): AssetTagWorkspace {
  if (current.readAt !== undefined && incoming.readAt !== undefined) {
    return incoming.readAt > current.readAt ? incoming : current;
  }
  return incoming;
}
