"use client";
import Image from "next/image";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  type AssetUploadResult,
  assetUploadResultSchema,
  type CompanyCrop,
  cropSchema,
} from "../contracts";
import { useCompanyMessages } from "../messages";
import { profileRequest } from "./api";
import { CommandFeedback, ProfileError } from "./CommandFeedback";
import { TextField } from "./Fields";
import { useDepartureGuard } from "./useDepartureGuard";
import { useProfileCommand } from "./useProfileApi";

const uploadSchema = z.object({
  requestId: z.uuid(),
  action: z.literal("upload_asset"),
  file: z.custom<File>((input) => typeof File !== "undefined" && input instanceof File),
  crop: cropSchema,
  slot: z.enum(["icon", "logo"]),
});
const fullCrop: CompanyCrop = { left: 0, top: 0, width: 1, height: 1 };
const cropLabels = {
  left: "cropLeft",
  top: "cropTop",
  width: "cropWidth",
  height: "cropHeight",
} as const;
function uploadAsset(payload: z.infer<typeof uploadSchema>, signal: AbortSignal) {
  const body = new FormData();
  body.set("requestId", payload.requestId);
  body.set("slot", payload.slot);
  body.set("file", payload.file);
  body.set("crop", JSON.stringify(payload.crop));
  return profileRequest("/api/company-profile/assets", assetUploadResultSchema, signal, body);
}
function centeredSquare(ratio: number): CompanyCrop {
  const width = Math.min(1, 1 / ratio);
  const height = Math.min(1, ratio);
  return { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
}
export function AssetChooser({
  slot,
  disabled,
  uploaded,
  scope,
}: {
  slot: "icon" | "logo";
  disabled: boolean;
  uploaded: (asset: AssetUploadResult) => void;
  scope: string;
}) {
  const m = useCompanyMessages();
  const inputId = useId();
  const [selected, setSelected] = useState<{ file: File; url: string } | null>(null);
  const [ratio, setRatio] = useState(1);
  const [crop, setCrop] = useState<CompanyCrop>(fullCrop);
  const [invalid, setInvalid] = useState(false);
  const command = useProfileCommand(
    `${scope}:asset:${slot}`,
    uploadSchema,
    assetUploadResultSchema,
    "/api/company-profile",
    uploadAsset,
  );
  const url = selected?.url ?? null;
  useEffect(() => {
    if (url !== null) return () => URL.revokeObjectURL(url);
  }, [url]);
  useDepartureGuard(selected !== null || command.command !== null, m.unsaved);
  const accept = (result: AssetUploadResult | null) => {
    if (result) {
      uploaded(result);
      setSelected(null);
    }
  };
  const locked = disabled || command.busy || command.command !== null;
  const label = slot === "icon" ? m.icon : m.logo;
  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block space-y-2 text-sm">
        <span className="font-medium">{label}</span>
        <Input
          id={inputId}
          aria-label={`${m.upload}: ${label}`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={locked}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (
              !file ||
              file.size > 2 * 1024 * 1024 ||
              !["image/png", "image/jpeg", "image/webp"].includes(file.type)
            ) {
              setInvalid(true);
              return;
            }
            setSelected({ file, url: URL.createObjectURL(file) });
            setCrop(fullCrop);
            setRatio(1);
            setInvalid(false);
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">{m.uploadHint}</p>
      {selected ? (
        <div className="space-y-3">
          <div
            className="relative max-w-full overflow-hidden rounded-md border"
            style={{ width: Math.min(180, 180 * ratio), height: Math.min(180, 180 / ratio) }}
          >
            <Image
              src={selected.url}
              alt={m.crop}
              fill
              unoptimized
              className="object-contain"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
              }}
            />
            <div
              className="absolute border-2 border-primary bg-primary/10"
              style={{
                left: `${crop.left * 100}%`,
                top: `${crop.top * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
            />
          </div>
          <details>
            <summary className="cursor-pointer text-sm">{m.crop}</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => setCrop(centeredSquare(ratio))}
              >
                {m.squareCrop}
              </Button>
              <Button variant="ghost" disabled={locked} onClick={() => setCrop(fullCrop)}>
                {m.fullImage}
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["left", "top", "width", "height"] as const).map((key) => (
                <TextField
                  key={key}
                  type="number"
                  label={m[cropLabels[key]]}
                  value={String(crop[key])}
                  onChange={(value) => setCrop({ ...crop, [key]: Number(value) })}
                  disabled={locked}
                />
              ))}
            </div>
          </details>
          <Button
            disabled={locked || !cropSchema.safeParse(crop).success}
            onClick={() => {
              void command
                .run({
                  action: "upload_asset",
                  requestId: crypto.randomUUID(),
                  slot,
                  file: selected.file,
                  crop,
                })
                .then(accept);
            }}
          >
            {command.busy ? m.saving : m.uploadImage}
          </Button>
        </div>
      ) : null}
      {invalid ? <ProfileError code="asset_invalid" /> : null}
      <CommandFeedback
        state={command}
        retry={() => {
          void command.retry().then(accept);
        }}
        discard={command.discard}
        cancel={() => {
          void command.cancel().then(accept);
        }}
      />
    </div>
  );
}
