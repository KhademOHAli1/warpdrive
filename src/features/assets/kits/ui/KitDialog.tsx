"use client";

import type { ReactNode } from "react";
import { CatalogEditorDialog } from "@/features/inventory/catalog/ui/CatalogFields";
import type { AssetsWorkspace } from "../../contracts";
import { type Kit, type KitCheckout, type KitIntent, validKitIntent } from "../contracts";
import type { KitWords } from "./messages";

export type KitEditor =
  | { type: "saveKit"; siteId: string; kit?: Kit }
  | { type: "moveKit"; kit: Kit }
  | { type: "checkoutKit"; kit: Kit }
  | { type: "returnKit"; kit: Kit; checkout: KitCheckout };

export type KitEditorState = {
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (intent: KitIntent) => void;
  restoreFocus: () => void;
};

export type KitEditorProps = {
  workspace: AssetsWorkspace;
  state: KitEditorState;
  words: KitWords;
};

export type KitOpener = (trigger: HTMLButtonElement, editor: KitEditor) => void;

export function KitDialog({
  state,
  intent,
  title,
  description,
  children,
}: {
  state: KitEditorState;
  intent: KitIntent | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const valid = intent !== null && validKitIntent(intent);
  return (
    <CatalogEditorDialog
      title={title}
      description={description}
      pending={state.pending}
      error={state.error}
      close={state.onClose}
      restoreFocus={state.restoreFocus}
      submitDisabled={!valid}
      submit={() => {
        if (valid) state.onSubmit(intent);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

export function currentKitVersion({ id, siteId, version }: Kit) {
  return { kitId: id, siteId, version };
}
