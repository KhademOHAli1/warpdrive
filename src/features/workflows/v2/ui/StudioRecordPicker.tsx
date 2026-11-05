"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import type { BlockJson, NativeEntity } from "@/features/blocks/contracts";
import { lookupWorkflowV2RecordsAction } from "../actions";
import { asArray, rawValue, textValue } from "./studioModel";
import type { StudioFormProps } from "./studioFormTypes";
import { StudioBound } from "./StudioFormControls";

export function StudioRecordPicker({
  multiple = false,
  ...props
}: StudioFormProps & { multiple?: boolean }) {
  const L = useSharedBlocksMessages();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const objectName = textValue(props.node.config.objectName) as NativeEntity;
  const key = multiple ? "recordIds" : "recordId";
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
      <BlockField label={L.searchVariables}>
        <Input
          aria-label={`${L.fields.recordId}: ${L.searchVariables}`}
          value={search}
          disabled={props.disabled}
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
                disabled={props.disabled}
                className="h-auto min-h-8 w-full justify-start text-start text-xs font-normal"
                onClick={() => choose(row.id)}
              >
                {row.label}
              </Button>
            ))
          )}
        </div>
      </BlockField>
    </div>
  );
}
