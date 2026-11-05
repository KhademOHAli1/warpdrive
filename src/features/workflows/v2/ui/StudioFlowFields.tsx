"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import type { BlockJson } from "@/features/blocks/contracts";
import { StudioCondition } from "./StudioCondition";
import { StudioBound, StudioFixed, StudioToggle } from "./StudioFormControls";
import { asArray, asObject, emptyCondition, freshId, textValue } from "./studioModel";
import type { StudioFormProps } from "./studioFormTypes";

function BranchFields(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const branches = asArray(props.node.config.branches).map(asObject);
  function update(next: BlockJson[]) {
    props.onChange({ ...props.node.config, branches: next });
  }
  return (
    <div className="space-y-4">
      {branches.map((branch, index) => (
        <section key={textValue(branch.id)} className="space-y-3 border-t pt-3">
          <div className="flex items-center gap-1">
            <Input
              aria-label={`${L.fields.routeName}: ${index + 1}`}
              value={textValue(branch.label)}
              placeholder={
                branch.condition === undefined ? L.elseRoute : `${L.fields.routeName} ${index + 1}`
              }
              disabled={props.disabled}
              onChange={(event) =>
                update(
                  branches.map((item, position) =>
                    position === index ? { ...item, label: event.target.value } : item,
                  ),
                )
              }
              className="h-8 text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={L.previous}
              disabled={props.disabled || index === 0 || branch.condition === undefined}
              onClick={() => {
                const next = [...branches];
                const previous = next[index - 1];
                if (previous !== undefined) {
                  next[index - 1] = branch;
                  next[index] = previous;
                  update(next);
                }
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={L.remove}
              disabled={props.disabled || branches.length < 2}
              onClick={() => update(branches.filter((_, position) => position !== index))}
            >
              ×
            </Button>
          </div>
          {branch.condition === undefined ? (
            <p className="text-xs text-muted-foreground">{L.elseRoute}</p>
          ) : (
            <StudioCondition
              {...props}
              value={branch.condition}
              onChange={(condition) =>
                update(
                  branches.map((item, position) =>
                    position === index ? { ...item, condition } : item,
                  ),
                )
              }
            />
          )}
        </section>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled || branches.length >= 20}
        onClick={() => {
          const fallback = branches.filter((branch) => branch.condition === undefined);
          update([
            ...branches.filter((branch) => branch.condition !== undefined),
            { id: freshId("route"), condition: emptyCondition() },
            ...fallback,
          ]);
        }}
      >
        {L.addRoute}
      </Button>
    </div>
  );
}
export function StudioFlowFields(
  props: StudioFormProps & { kind: "FILTER" | "IF_ELSE" | "ITERATOR" | "DELAY" | "WAIT_FOR_EVENT" },
) {
  const L = useSharedBlocksMessages();
  const { node } = props;
  switch (props.kind) {
    case "FILTER":
      return (
        <StudioCondition
          {...props}
          value={node.config.condition}
          onChange={(condition) => props.onChange({ ...node.config, condition })}
        />
      );
    case "IF_ELSE":
      return <BranchFields {...props} />;
    case "ITERATOR":
      return (
        <>
          <StudioBound {...props} name="items" label={L.fields.items} type="array" />
          <StudioToggle
            {...props}
            name="shouldContinueOnIterationFailure"
            label={L.fields.continueOnFailure}
          />
        </>
      );
    case "DELAY":
      return (
        <>
          <StudioFixed
            {...props}
            name="mode"
            label={L.fields.type}
            options={[
              { value: "duration", label: L.fields.duration ?? "" },
              { value: "date", label: L.fields.scheduled ?? "" },
            ]}
          />
          {node.config.mode === "date" ? (
            <StudioBound {...props} name="until" label={L.fields.scheduled} type="instant" />
          ) : (
            <StudioBound {...props} name="seconds" label={L.fields.seconds} type="number" />
          )}
        </>
      );
    case "WAIT_FOR_EVENT":
      return (
        <>
          <BlockField label={L.fields.event ?? ""}>
            <Select
              ariaLabel={L.fields.event ?? ""}
              value={textValue(node.config.eventName)}
              disabled={props.disabled}
              options={props.studio.objects.flatMap((object) =>
                ["created", "updated", "deleted"].map((event) => ({
                  value: `${object.name}.${event}`,
                  label: `${object.label} · ${L.triggers[event] ?? event}`,
                })),
              )}
              onChange={(eventName) => props.onChange({ ...node.config, eventName })}
            />
          </BlockField>
          <StudioBound {...props} name="recordId" label={L.fields.recordId} />
          <StudioBound
            {...props}
            name="updatedFields"
            label={L.fields.updatedFields}
            type="array"
          />
          <StudioBound
            {...props}
            name="timeoutSeconds"
            label={`${L.fields.timeout} · ${L.fields.seconds}`}
            type="number"
          />
        </>
      );
  }
}
