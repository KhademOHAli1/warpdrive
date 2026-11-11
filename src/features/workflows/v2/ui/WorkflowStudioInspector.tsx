"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { WorkflowV2Node } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioAiFields } from "./StudioAiFields";
import { StudioCommunicationFields } from "./StudioCommunicationFields";
import { StudioFlowFields } from "./StudioFlowFields";
import { StudioBound } from "./StudioFormControls";
import { StudioHumanFields } from "./StudioHumanFields";
import { StudioIntegrationFields } from "./StudioIntegrationFields";
import { StudioNativeFields } from "./StudioNativeFields";
import { StudioRecordOptions } from "./StudioRecordPicker";
import type { StudioFormProps } from "./studioFormTypes";
import styles from "./studioInspector.module.css";
import { studioSetupHref, textValue } from "./studioModel";

export function WorkflowStudioInspector(
  props: StudioFormProps & { onNodeChange: (node: WorkflowV2Node) => void; onRemove: () => void },
) {
  const L = useSharedBlocksMessages();
  const readiness = props.studio.readiness[props.node.type];
  function fields() {
    switch (props.node.type) {
      case "CREATE_RECORD":
      case "UPDATE_RECORD":
      case "DELETE_RECORD":
      case "UPSERT_RECORD":
      case "FIND_RECORDS":
      case "PICK_RECORD":
        return <StudioNativeFields {...props} />;
      case "FILTER":
      case "IF_ELSE":
      case "ITERATOR":
      case "DELAY":
      case "WAIT_FOR_EVENT":
        return <StudioFlowFields {...props} kind={props.node.type} />;
      case "NEWSLETTER_CONSENT_STATUS":
      case "NEWSLETTER_INVITE":
        return (
          <>
            <StudioBound {...props} name="personId" type="string" />
            <StudioRecordOptions
              objectName="person"
              selected={[textValue(props.node.config.personId)]}
              disabled={props.disabled}
              onChoose={(personId) => props.onChange({ ...props.node.config, personId })}
            />
            <StudioBound {...props} name="listId" type="number" />
            {props.node.type === "NEWSLETTER_INVITE" && (
              <StudioBound {...props} name="linkId" type="string" />
            )}
          </>
        );
      case "SEND_EMAIL":
      case "DRAFT_EMAIL":
      case "SEND_CHAT_MESSAGE":
      case "CREATE_CALENDAR_EVENT":
        return <StudioCommunicationFields {...props} kind={props.node.type} />;
      case "FORM":
        return <StudioHumanFields {...props} />;
      case "HTTP_REQUEST":
      case "CODE":
      case "LOGIC_FUNCTION":
        return <StudioIntegrationFields {...props} kind={props.node.type} />;
      case "AI_AGENT":
      case "CLASSIFY":
        return <StudioAiFields {...props} />;
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <div className={styles.content}>
        <BlockField label={L.fields.name ?? ""}>
          <Input
            aria-label={L.fields.name}
            value={props.node.name}
            disabled={props.disabled}
            maxLength={100}
            onChange={(event) => props.onNodeChange({ ...props.node, name: event.target.value })}
            className="h-9 text-xs"
          />
        </BlockField>
        {readiness !== undefined &&
          readiness.state !== "ready" &&
          readiness.state !== "needs_configuration" && (
            <div className="space-y-1 border-s-2 ps-3 text-xs text-muted-foreground">
              <p>{readiness.state === "forbidden" ? L.denied : L.needsSetup}</p>
              {readiness.state === "needs_connection" && (
                <a href={studioSetupHref(props.node.type)} className="text-link">
                  {L.openSettings}
                </a>
              )}
            </div>
          )}
        {fields()}
      </div>
      <div className={styles.footer}>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          className="text-destructive"
          onClick={props.onRemove}
        >
          {L.remove}
        </Button>
      </div>
    </div>
  );
}
