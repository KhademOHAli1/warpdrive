"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LABEL_COLOR_CLASSES, type LabelColor } from "@/constants/labelColors";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { ReorderControls } from "../ReorderControls";
import { LabelColorSelect } from "./LabelColorSelect";

export interface LabelRowData {
  id: string;
  name: string;
  color: LabelColor;
}
interface Props {
  row: LabelRowData;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  onMove: (direction: "up" | "down") => void;
  onRename: (name: string) => Promise<boolean>;
  onColor: (color: LabelColor) => void;
  onDelete: () => void;
}

export function LabelRow({
  row,
  isFirst,
  isLast,
  pending,
  onMove,
  onRename,
  onColor,
  onDelete,
}: Props): React.ReactNode {
  const L = useSettingsMessages();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);

  async function save(): Promise<void> {
    const next = name.trim();
    if (next !== "" && (await onRename(next))) setEditing(false);
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            aria-label={`${L.labelName}: ${row.name}`}
            autoComplete="off"
            required
            maxLength={120}
            disabled={pending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <span
            className={`inline-block max-w-full break-words rounded border px-2 py-0.5 text-sm ${LABEL_COLOR_CLASSES[row.color]}`}
          >
            {row.name}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:ms-auto">
        <div className="w-32 max-w-full">
          <LabelColorSelect
            ariaLabel={`${L.color}: ${row.name}`}
            value={row.color}
            onChange={onColor}
            disabled={pending}
          />
        </div>
        <ReorderControls
          canMoveUp={!pending && !isFirst}
          canMoveDown={!pending && !isLast}
          onMoveUp={() => onMove("up")}
          onMoveDown={() => onMove("down")}
        />
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={pending || name.trim() === "" || name.trim() === row.name}
              onClick={() => void save()}
            >
              {L.save}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => {
                setName(row.name);
                setEditing(false);
              }}
            >
              {L.cancel}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10"
            disabled={pending}
            aria-label={`${L.rename}: ${row.name}`}
            onClick={() => {
              setName(row.name);
              setEditing(true);
            }}
          >
            {L.rename}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-10"
          disabled={pending}
          aria-label={`${L.delete}: ${row.name}`}
          onClick={onDelete}
        >
          {L.delete}
        </Button>
      </div>
    </li>
  );
}
