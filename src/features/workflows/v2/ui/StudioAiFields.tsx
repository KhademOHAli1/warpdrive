"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioBound, StudioFixed, StudioSchemaFields } from "./StudioFormControls";
import type { StudioFormProps } from "./studioFormTypes";
import { asArray, asObject, textValue } from "./studioModel";
import { useDraftRowKeys } from "./useDraftRowKeys";

function ClassifyQuestions(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const questions = asArray(props.node.config.questions).map(asObject);
  const rowKeys = useDraftRowKeys(questions.length);
  function update(next: BlockJson[]) {
    props.onChange({ ...props.node.config, questions: next });
  }
  return (
    <div className="space-y-4">
      {rowKeys.keys.map((key, index) => {
        const question = questions[index];
        if (question === undefined) return null;
        function change(patch: Record<string, BlockJson>) {
          update(
            questions.map((item, position) => (position === index ? { ...item, ...patch } : item)),
          );
        }
        return (
          <section key={key} className="space-y-3 border-t pt-3">
            <BlockField label={L.fields.name ?? ""}>
              <Input
                aria-label={`${L.fields.question}: ${index + 1}`}
                disabled={props.disabled}
                value={textValue(question.key)}
                onChange={(event) => change({ key: event.target.value })}
                className="h-8 text-xs"
              />
            </BlockField>
            <Select
              ariaLabel={`${L.fields.type}: ${index + 1}`}
              disabled={props.disabled}
              value={textValue(question.type)}
              options={["boolean", "choice", "score"].map((value) => ({
                value,
                label: L.fields[value] ?? value,
              }))}
              onChange={(type) => change({ type })}
            />
            <Textarea
              aria-label={`${L.fields.instructions}: ${index + 1}`}
              disabled={props.disabled}
              value={textValue(question.instructions)}
              onChange={(event) => change({ instructions: event.target.value })}
              className="text-xs"
            />
            {question.type === "choice" && (
              <Input
                aria-label={`${L.fields.options}: ${index + 1}`}
                disabled={props.disabled}
                value={asArray(question.choices).map(String).join(", ")}
                onChange={(event) =>
                  change({
                    choices: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter((value) => value !== ""),
                  })
                }
                className="h-8 text-xs"
              />
            )}
            {question.type === "score" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label={`${L.operators.gte}: ${index + 1}`}
                  disabled={props.disabled}
                  type="number"
                  value={textValue(question.min)}
                  onChange={(event) => change({ min: Number(event.target.value) })}
                  className="h-8 text-xs"
                />
                <Input
                  aria-label={`${L.operators.lte}: ${index + 1}`}
                  disabled={props.disabled}
                  type="number"
                  value={textValue(question.max)}
                  onChange={(event) => change({ max: Number(event.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={props.disabled || questions.length === 1}
              onClick={() => {
                rowKeys.remove(index);
                update(questions.filter((_, position) => position !== index));
              }}
            >
              {L.remove}
            </Button>
          </section>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled || questions.length >= 40}
        onClick={() =>
          update([
            ...questions,
            { key: `answer_${questions.length + 1}`, type: "boolean", instructions: "" },
          ])
        }
      >
        {L.addField}
      </Button>
    </div>
  );
}
export function StudioAiFields(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  return props.node.type === "CLASSIFY" ? (
    <>
      <StudioBound {...props} name="input" label={L.fields.state} multiline />
      <ClassifyQuestions {...props} />
    </>
  ) : (
    <>
      <StudioFixed
        {...props}
        name="providerModel"
        label={L.fields.model}
        options={[
          { value: "", label: L.fields.model ?? "" },
          ...props.studio.models.map((model) => ({ value: model.id, label: model.label })),
        ]}
      />
      <StudioBound {...props} name="instructions" multiline />
      <StudioBound {...props} name="prompt" multiline />
      <StudioSchemaFields {...props} name="responseSchema" />
    </>
  );
}
