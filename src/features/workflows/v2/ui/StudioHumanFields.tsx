"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioBound } from "./StudioFormControls";
import type { StudioFormProps } from "./studioFormTypes";
import { asArray, asObject, freshId, textValue } from "./studioModel";

export function StudioHumanFields(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const fields = asArray(props.node.config.fields).map(asObject);
  function update(next: BlockJson[]) {
    props.onChange({ ...props.node.config, fields: next });
  }
  return (
    <>
      <StudioBound {...props} name="instructions" multiline />
      {fields.map((field, index) => {
        function change(patch: Record<string, BlockJson>) {
          update(
            fields.map((item, position) => (position === index ? { ...item, ...patch } : item)),
          );
        }
        return (
          <section key={textValue(field.id)} className="space-y-3 border-t pt-4">
            <BlockField label={L.fields.name ?? ""}>
              <Input
                aria-label={`${L.fields.name}: ${index + 1}`}
                disabled={props.disabled}
                value={textValue(field.name)}
                onChange={(event) => change({ name: event.target.value })}
                className="h-8 text-xs"
              />
            </BlockField>
            <BlockField label={L.fields.label ?? ""}>
              <Input
                aria-label={`${L.fields.label}: ${index + 1}`}
                disabled={props.disabled}
                value={textValue(field.label)}
                onChange={(event) => change({ label: event.target.value })}
                className="h-8 text-xs"
              />
            </BlockField>
            <Select
              ariaLabel={`${L.fields.type}: ${index + 1}`}
              disabled={props.disabled}
              value={textValue(field.type)}
              options={["TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "RECORD"].map(
                (value) => ({
                  value,
                  label:
                    L.types[
                      value === "TEXT"
                        ? "string"
                        : value === "SELECT" || value === "MULTI_SELECT"
                          ? "array"
                          : value.toLowerCase()
                    ] ?? value,
                }),
              )}
              onChange={(type) => change({ type })}
            />
            {["SELECT", "MULTI_SELECT"].includes(textValue(field.type)) && (
              <BlockField label={L.fields.options ?? ""}>
                <Input
                  aria-label={`${L.fields.options}: ${index + 1}`}
                  value={asArray(field.options).map(String).join(", ")}
                  disabled={props.disabled}
                  onChange={(event) =>
                    change({
                      options: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter((value) => value !== ""),
                    })
                  }
                  className="h-8 text-xs"
                />
              </BlockField>
            )}
            {field.type === "RECORD" && (
              <Select
                ariaLabel={`${L.fields.objectName}: ${index + 1}`}
                disabled={props.disabled}
                value={textValue(field.objectName)}
                options={props.studio.objects.map((object) => ({
                  value: object.name,
                  label: object.label,
                }))}
                onChange={(objectName) => change({ objectName })}
              />
            )}
            <Select
              ariaLabel={`${L.required}: ${index + 1}`}
              disabled={props.disabled}
              value={field.required === true ? "true" : "false"}
              options={[
                { value: "true", label: L.required },
                { value: "false", label: L.optional },
              ]}
              onChange={(required) => change({ required: required === "true" })}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={props.disabled || fields.length === 1}
              onClick={() => update(fields.filter((_, position) => position !== index))}
            >
              {L.remove}
            </Button>
          </section>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled || fields.length >= 40}
        onClick={() =>
          update([
            ...fields,
            {
              id: freshId("field"),
              name: `answer_${fields.length + 1}`,
              label: "",
              type: "TEXT",
              required: false,
            },
          ])
        }
      >
        {L.addField}
      </Button>
    </>
  );
}
