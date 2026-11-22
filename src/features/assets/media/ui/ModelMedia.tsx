"use client";

import { ImageIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { AssetModel } from "../../contracts";
import type { AssetMediaAccess } from "../contracts";
import { AssetMediaCover, AssetMediaPanel } from "./AssetMedia";
import { assetMediaMessages } from "./messages";
import { useAssetMedia } from "./useAssetMedia";

function ModelCoverDialog({
  model,
  access,
  canManage,
  busy,
  close,
  restoreFocus,
}: {
  model: AssetModel;
  access: AssetMediaAccess;
  canManage: boolean;
  busy: boolean;
  close: () => void;
  restoreFocus: () => void;
}) {
  const t = assetMediaMessages[useLocale()];
  const state = useAssetMedia(
    access,
    { type: "model", id: model.id },
    `${model.version}:${canManage}`,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) close();
      }}
    >
      <DialogContent
        data-model-media-dialog={model.id}
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t.openModel} · <bdi dir="auto">{model.name}</bdi>
          </DialogTitle>
          <DialogDescription>{t.modelDescription}</DialogDescription>
        </DialogHeader>
        <AssetMediaCover state={state} />
        <AssetMediaPanel state={state} canManage={canManage} busy={busy} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={state.pending} onClick={close}>
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModelMediaButton({
  model,
  access,
  canManage,
  busy,
}: {
  model: AssetModel;
  access: AssetMediaAccess;
  canManage: boolean;
  busy: boolean;
}) {
  const t = assetMediaMessages[useLocale()];
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        data-model-media-open={model.id}
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <ImageIcon size={14} aria-hidden="true" /> {t.openModel}
      </Button>
      {open && (
        <ModelCoverDialog
          model={model}
          access={access}
          canManage={canManage}
          busy={busy}
          close={() => setOpen(false)}
          restoreFocus={() => trigger.current?.focus()}
        />
      )}
    </>
  );
}
