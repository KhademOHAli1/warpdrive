"use client";
import { Textarea } from "@/components/ui/Textarea";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import {
  StudioBound,
  StudioFixed,
  StudioKeyValues,
  StudioSchemaFields,
} from "./StudioFormControls";
import { StudioValue } from "./StudioValue";
import { fieldCatalog, type StudioFormProps } from "./studioFormTypes";
import { asObject, textValue } from "./studioModel";

export function StudioIntegrationFields(
  props: StudioFormProps & { kind: "HTTP_REQUEST" | "CODE" | "LOGIC_FUNCTION" },
) {
  const L = useSharedBlocksMessages();
  switch (props.kind) {
    case "HTTP_REQUEST":
      return (
        <>
          <StudioFixed
            {...props}
            name="method"
            options={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((value) => ({
              value,
              label: value,
            }))}
          />
          <StudioBound {...props} name="url" />
          <StudioKeyValues {...props} name="headers" />
          {props.node.config.method !== "GET" && props.node.config.method !== "HEAD" && (
            <StudioKeyValues {...props} name="body" label={L.fields.requestBody} />
          )}
          <StudioSchemaFields {...props} name="responseSchema" />
        </>
      );
    case "CODE":
      return (
        <>
          <BlockField label={L.fields.code ?? ""}>
            <Textarea
              aria-label={L.fields.code}
              value={textValue(props.node.config.sourceCode)}
              disabled={props.disabled}
              onChange={(event) =>
                props.onChange({ ...props.node.config, sourceCode: event.target.value })
              }
              maxLength={50000}
              spellCheck={false}
              dir="ltr"
              className="min-h-56 font-mono text-xs"
            />
          </BlockField>
          <StudioKeyValues {...props} name="inputs" label={L.inputs} />
          <StudioSchemaFields {...props} name="outputSchema" />
        </>
      );
    case "LOGIC_FUNCTION": {
      const selected = props.studio.functions.find(
        (fn) => fn.id === textValue(props.node.config.functionId),
      );
      const inputs = asObject(props.node.config.inputs);
      return (
        <>
          <StudioFixed
            {...props}
            name="functionId"
            label={L.fields.function}
            options={[
              { value: "", label: L.fields.function ?? "" },
              ...props.studio.functions.map((fn) => ({ value: fn.id, label: fn.label })),
            ]}
          />
          {selected?.inputs.map((input) => (
            <StudioValue
              key={input.key}
              label={input.label}
              type={input.type}
              value={inputs[input.key]}
              definition={props.definition}
              nodeId={props.node.id}
              fields={fieldCatalog(props.studio)}
              disabled={props.disabled}
              onChange={(value) =>
                props.onChange({ ...props.node.config, inputs: { ...inputs, [input.key]: value } })
              }
            />
          ))}
          {selected === undefined && (
            <p className="text-xs text-muted-foreground">{L.needsSetup}</p>
          )}
        </>
      );
    }
  }
}
