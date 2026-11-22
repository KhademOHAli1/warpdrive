import type { AssetsWorkspace } from "../contracts";
import type {
  AssetMediaAccess,
  AssetMediaEvent,
  AssetMediaFile,
  AssetMediaResult,
  AssetMediaRevision,
  AssetMediaTarget,
  AssetMediaWorkspace,
} from "./contracts";
import { assetMediaUploadMetadata, hasAssetMediaSignature } from "./fileRules";

type Register = Pick<AssetsWorkspace, "records" | "models" | "sites">;
type MediaEntry = Pick<AssetMediaWorkspace, "version" | "files" | "history" | "coverId">;

const emptyEntry: MediaEntry = { version: 0, files: [], history: [], coverId: null };
const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;

function targetKey(target: AssetMediaTarget) {
  return `${target.type}:${target.id}`;
}

function assetMediaTarget(register: Register, target: AssetMediaTarget) {
  const asset =
    target.type === "asset" ? register.records.find(({ id }) => id === target.id) : undefined;
  const model =
    target.type === "model" ? register.models.find(({ id }) => id === target.id) : undefined;
  const siteId = asset?.siteId ?? model?.siteId;
  const site = register.sites.find(({ id }) => id === siteId);
  if (site === undefined) return null;
  return {
    canManage: site.canManage && (asset === undefined || asset.archivedAt === null),
    modelId: asset?.tracking === "individual" ? asset.modelId : null,
    siteId: site.id,
  };
}

function cover(entry: MediaEntry) {
  return entry.files.find(({ id, kind }) => id === entry.coverId && kind === "photo") ?? null;
}

export function createAssetMediaFixture(initial: Register) {
  let register = initial;
  const entries = new Map<string, MediaEntry>();
  const receipts = new Map<string, string>();
  const urls = new Set<string>();

  function getEntry(target: AssetMediaTarget) {
    return entries.get(targetKey(target)) ?? emptyEntry;
  }

  function project(target: AssetMediaTarget): AssetMediaResult {
    const owner = assetMediaTarget(register, target);
    if (owner === null) return unavailable;
    const state = getEntry(target);
    const model = register.models.find(
      ({ id, siteId }) => id === owner.modelId && siteId === owner.siteId,
    );
    const inheritedCover =
      model === undefined ? null : cover(getEntry({ type: "model", id: model.id }));
    return {
      ok: true,
      value: { target, canManage: owner.canManage, ...state, inheritedCover },
    };
  }

  function change(
    input: AssetMediaRevision,
    fingerprint: string,
    transform: (state: MediaEntry) => Omit<MediaEntry, "version"> | null,
  ): AssetMediaResult {
    const { target, version, requestId } = input;
    const current = project(target);
    if (!current.ok || !current.value.canManage) return unavailable;
    const receipt = receipts.get(requestId);
    if (receipt !== undefined) return receipt === fingerprint ? current : conflict;
    if (current.value.version !== version) return conflict;
    const next = transform(current.value);
    if (next === null) return invalid;
    entries.set(targetKey(target), { ...next, version: version + 1 });
    receipts.set(requestId, fingerprint);
    return project(target);
  }

  function event(
    type: AssetMediaEvent["type"],
    fileId: string | null,
    at: string,
  ): AssetMediaEvent {
    return { id: crypto.randomUUID(), type, fileId, at, actor: "Demo operator" };
  }

  let generation = 0;
  const access: AssetMediaAccess = {
    read: (target) => Promise.resolve(project(target)),
    upload: async ({ target, version, requestId, kind, file }) => {
      const current = project(target);
      if (!current.ok || !current.value.canManage) return unavailable;
      const metadata = assetMediaUploadMetadata({
        target,
        kind,
        name: file.name,
        mime: file.type,
        sizeBytes: file.size,
      });
      if (metadata === null) return invalid;
      const uploadGeneration = generation;
      const buffer = await file.arrayBuffer();
      if (!hasAssetMediaSignature(new Uint8Array(buffer), metadata.mime)) return invalid;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      if (generation !== uploadGeneration) return unavailable;
      const fingerprint = JSON.stringify([
        "upload",
        targetKey(target),
        version,
        kind,
        metadata,
        [...digest],
      ]);
      return change({ target, version, requestId }, fingerprint, (state) => {
        const href = URL.createObjectURL(file);
        urls.add(href);
        const id = crypto.randomUUID();
        const at = new Date().toISOString();
        const stored: AssetMediaFile = {
          id,
          kind,
          ...metadata,
          uploadedAt: at,
          uploadedBy: "Demo operator",
          previewHref: kind === "photo" ? href : null,
          downloadHref: href,
        };
        return {
          files: [stored, ...state.files],
          history: [event("uploaded", id, at), ...state.history],
          coverId: kind === "photo" ? id : state.coverId,
        };
      });
    },
    setCover: ({ target, version, requestId, fileId }) => {
      const fingerprint = JSON.stringify(["cover", targetKey(target), version, fileId]);
      const result = change({ target, version, requestId }, fingerprint, (state) => {
        if (
          state.coverId === fileId ||
          (fileId !== null &&
            !state.files.some(({ id, kind }) => id === fileId && kind === "photo"))
        )
          return null;
        return {
          files: state.files,
          history: [event("cover_changed", fileId, new Date().toISOString()), ...state.history],
          coverId: fileId,
        };
      });
      return Promise.resolve(result);
    },
  };

  return {
    access,
    updateRegister: (next: Register) => {
      register = next;
    },
    dispose: () => {
      generation += 1;
      for (const href of urls) URL.revokeObjectURL(href);
      urls.clear();
      entries.clear();
      receipts.clear();
    },
  };
}
