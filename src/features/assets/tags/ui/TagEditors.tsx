"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { EditorSelect } from "@/features/assets/ui/AssetEditorFields";
import { CatalogEditorDialog, CatalogField } from "@/features/inventory/catalog/ui/CatalogFields";
import type {
  AssetTagCommand,
  AssetTagRecord,
  AssetTagSite,
  AssetTagTarget,
  AssetTagTargetRef,
} from "../contracts";
import { assetTagText } from "../tagCodes";
import type { AssetTagWords } from "./tagMessages";

type WithoutRequest<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type AssetTagIntent = WithoutRequest<AssetTagCommand>;
export type TagEditor =
  | { type: "createBatch" }
  | { type: "importLegacy" }
  | { type: "claim" | "swap" | "unlink" | "setOwnerContact"; tagId: string };

export type TagDialogState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: AssetTagIntent) => void;
};

type Shared = { state: TagDialogState; words: AssetTagWords };
type TagChangeEditor = Exclude<TagEditor, { type: "importLegacy" }>;

export function targetKey({ kind, id }: AssetTagTargetRef) {
  return `${kind}:${id}`;
}

export function targetOption({ title, subtitle, kind }: AssetTagTarget, words: AssetTagWords) {
  return [words[kind], title, subtitle].filter((item) => item !== null).join(" · ");
}

function TagForm({
  title,
  description,
  intent,
  state,
  children,
}: {
  title: string;
  description: string;
  intent: AssetTagIntent | null;
  state: TagDialogState;
  children: React.ReactNode;
}) {
  return (
    <CatalogEditorDialog
      {...{ title, description }}
      pending={state.pending}
      error={state.error}
      close={state.close}
      restoreFocus={state.restoreFocus}
      submitDisabled={intent === null}
      submit={() => {
        if (intent !== null) state.save(intent);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

function IssueTags({ site, state, words: t }: Shared & { site: AssetTagSite }) {
  const titleId = useId();
  const numberId = useId();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("1");
  const count = Number(amount);
  const valid = title.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= 100;
  return (
    <TagForm
      title={t.issue}
      description={t.issueDescription}
      state={state}
      intent={valid ? { type: "createBatch", siteId: site.id, title: title.trim(), count } : null}
    >
      <CatalogField id={titleId} label={t.batchTitle}>
        <Input
          id={titleId}
          value={title}
          maxLength={100}
          disabled={state.pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </CatalogField>
      <CatalogField id={numberId} label={t.numberOfTags}>
        <Input
          id={numberId}
          type="number"
          min={1}
          max={100}
          step={1}
          value={amount}
          disabled={state.pending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </CatalogField>
    </TagForm>
  );
}

function ClaimTag({
  tag,
  tags,
  targets,
  state,
  words: t,
}: Shared & { tag: AssetTagRecord; tags: AssetTagRecord[]; targets: AssetTagTarget[] }) {
  const [targetId, setTarget] = useState("");
  const assigned = new Set(
    tags.flatMap(({ assignment }) => (assignment === null ? [] : [targetKey(assignment.target)])),
  );
  const targetsAvailable = targets.filter(
    (target) => target.canManage && !assigned.has(targetKey(target)),
  );
  const chosen = targetsAvailable.find((target) => targetKey(target) === targetId);
  const intent: AssetTagIntent | null =
    chosen === undefined
      ? null
      : {
          type: "claim",
          tagId: tag.id,
          target: { kind: chosen.kind, id: chosen.id },
        };
  return (
    <TagForm title={t.claim} description={t.claimDescription} state={state} intent={intent}>
      <div className="text-sm">
        <span className="me-2 text-muted-foreground">{t.tag}</span>
        <bdi dir="ltr" className="font-mono text-xs">
          {assetTagText(tag.token)}
        </bdi>
      </div>
      <EditorSelect
        label={t.target}
        value={targetId}
        disabled={state.pending || targetsAvailable.length === 0}
        options={[
          { value: "", label: t.chooseTarget },
          ...targetsAvailable.map((target) => ({
            value: targetKey(target),
            label: targetOption(target, t),
          })),
        ]}
        onChange={setTarget}
      />
      {targetsAvailable.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.noTargets}</p>
      )}
    </TagForm>
  );
}

function SwapTag({
  tag,
  tags,
  state,
  words: t,
}: Shared & { tag: AssetTagRecord; tags: AssetTagRecord[] }) {
  const [previousId, setPrevious] = useState(tag.id);
  const [replacementId, setReplacement] = useState("");
  const assigned = tags.filter(({ assignment }) => assignment?.target.canManage === true);
  const available = tags.filter(({ assignment }) => assignment === null);
  const previous = assigned.find(({ id }) => id === previousId);
  const replacement = available.find(({ id }) => id === replacementId);
  const assignment = previous?.assignment;
  const intent: AssetTagIntent | null =
    previous === undefined || assignment == null || replacement === undefined
      ? null
      : {
          type: "swap",
          tagId: replacement.id,
          previousTagId: previous.id,
          assignmentId: assignment.id,
        };
  return (
    <TagForm title={t.swap} description={t.swapDescription} state={state} intent={intent}>
      <EditorSelect
        label={t.previous}
        value={previousId}
        disabled={state.pending}
        options={assigned.map(({ id, token, assignment: current }) => ({
          value: id,
          label: `${assetTagText(token)} · ${current?.target.title ?? ""}`,
        }))}
        onChange={setPrevious}
      />
      <EditorSelect
        label={t.replacement}
        value={replacementId}
        disabled={state.pending || available.length === 0}
        options={[
          { value: "", label: t.chooseTag },
          ...available.map(({ id, token }) => ({ value: id, label: assetTagText(token) })),
        ]}
        onChange={setReplacement}
      />
    </TagForm>
  );
}

function AssignmentChange({
  type,
  tag,
  state,
  words: t,
}: Shared & { type: "unlink" | "setOwnerContact"; tag: AssetTagRecord }) {
  const assignment = tag.assignment;
  if (assignment === null || !assignment.target.canManage) return null;
  const enable = !assignment.ownerContact;
  const intent: AssetTagIntent =
    type === "unlink"
      ? { type, tagId: tag.id, assignmentId: assignment.id }
      : { type, tagId: tag.id, assignmentId: assignment.id, enabled: enable };
  const title = type === "unlink" ? t.unlink : enable ? t.enableContact : t.disableContact;
  const description =
    type === "unlink" ? t.unlinkDescription : enable ? t.enableDescription : t.disableDescription;
  return (
    <TagForm {...{ title, description, state, intent }}>
      <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">
          <bdi>{assignment.target.title}</bdi>
        </p>
        <bdi dir="ltr" className="font-mono text-xs [overflow-wrap:anywhere]">
          {assetTagText(tag.token)}
        </bdi>
      </div>
    </TagForm>
  );
}

export function TagChangeDialog({
  editor,
  site,
  tags,
  targets,
  state,
  words,
}: Shared & {
  editor: TagChangeEditor;
  site: AssetTagSite;
  tags: AssetTagRecord[];
  targets: AssetTagTarget[];
}) {
  if (!site.canManage) return null;
  if (editor.type === "createBatch") return <IssueTags {...{ site, state, words }} />;
  if ("tagId" in editor) {
    const tag = tags.find(({ id }) => id === editor.tagId);
    if (tag === undefined) return null;
    switch (editor.type) {
      case "claim":
        return tag.assignment === null ? (
          <ClaimTag {...{ tag, tags, targets, state, words }} />
        ) : null;
      case "swap":
        return tag.assignment?.target.canManage === true ? (
          <SwapTag {...{ tag, tags, state, words }} />
        ) : null;
      case "unlink":
      case "setOwnerContact":
        return <AssignmentChange type={editor.type} {...{ tag, state, words }} />;
    }
  }
  return null;
}
