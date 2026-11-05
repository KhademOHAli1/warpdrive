"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { BlockJson, NativeEntity } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { lookupWorkflowV2RecordsAction } from "../actions";
import { StudioBound } from "./StudioFormControls";
import type { StudioFormProps } from "./studioFormTypes";
import { asArray, rawValue, textValue } from "./studioModel";

export function StudioRecordOptions({
  objectName,
  selected,
  disabled,
  selectionLimit,
  onChoose,
}: {
  objectName: NativeEntity;
  selected: readonly string[];
  disabled: boolean;
  selectionLimit?: number;
  onChoose: (id: string) => void;
}) {
  const L = useSharedBlocksMessages();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    const controller = setTimeout(() => {
      setLoading(true);
      void lookupWorkflowV2RecordsAction({ objectName, search })
        .then((result) => {
          if (request !== generation.current) return;
          if (result.ok) {
            setRows(result.value);
            setError(false);
          } else setError(true);
        })
        .catch(() => {
          if (request === generation.current) setError(true);
        })
        .finally(() => {
          if (request === generation.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(controller);
      generation.current += 1;
    };
  }, [objectName, search]);
  return (
    <BlockField label={L.searchRecords}>
      <Input
        aria-label={L.searchRecords}
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
        className="h-8 text-xs"
      />
      <div className="max-h-36 overflow-y-auto">
        {loading && (
          <p role="status" className="py-2 text-xs text-muted-foreground">
            {L.working}
          </p>
        )}
        {error ? (
          <p role="alert" className="py-2 text-xs text-destructive">
            {L.failed}
          </p>
        ) : (
          rows.map((row) => (
            <Button
              key={row.id}
              variant={selected.includes(row.id) ? "outline" : "ghost"}
              size="sm"
              aria-pressed={selected.includes(row.id)}
              disabled={
                disabled ||
                (selectionLimit !== undefined &&
                  selected.length >= selectionLimit &&
                  !selected.includes(row.id))
              }
              className="h-auto min-h-8 w-full justify-start text-start text-xs font-normal"
              onClick={() => onChoose(row.id)}
            >
              {row.label}
            </Button>
          ))
        )}
      </div>
    </BlockField>
  );
}

export function StudioRecordPicker({
  multiple = false,
  ...props
}: StudioFormProps & { multiple?: boolean }) {
  const L = useSharedBlocksMessages();
  const objectName = textValue(props.node.config.objectName) as NativeEntity;
  const key = multiple ? "recordIds" : "recordId";
  const selected = multiple
    ? asArray(rawValue(props.node.config[key])).filter(
        (value): value is string => typeof value === "string",
      )
    : [textValue(props.node.config[key])];
  function choose(id: string) {
    const value: BlockJson = multiple
      ? selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id]
      : id;
    props.onChange({ ...props.node.config, [key]: { kind: "literal", value } });
  }
  return (
    <div className="space-y-2">
      <StudioBound
        {...props}
        name={key}
        label={L.fields[multiple ? "candidates" : "recordId"]}
        type={multiple ? "array" : "string"}
      />
      <StudioRecordOptions
        objectName={objectName}
        selected={selected}
        disabled={props.disabled}
        onChoose={choose}
      />
    </div>
  );
}
