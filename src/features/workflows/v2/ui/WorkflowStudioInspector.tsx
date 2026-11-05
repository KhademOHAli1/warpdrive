"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { StudioNativeFields } from "./StudioNativeFields";
import { StudioFlowFields } from "./StudioFlowFields";
import { StudioCommunicationFields } from "./StudioCommunicationFields";
import { StudioHumanFields } from "./StudioHumanFields";
import { StudioIntegrationFields } from "./StudioIntegrationFields";
import { StudioAiFields } from "./StudioAiFields";
import type { StudioFormProps } from "./studioFormTypes";
import type { WorkflowV2Node } from "@/features/blocks/contracts";
import { studioSetupHref } from "./studioModel";

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
      <div className="border-b px-4 py-3">
        <p className="text-[10px] text-muted-foreground">{L.blocks[props.node.type]}</p>
        <h2 className="mt-1 text-sm font-medium" dir="auto">
          {props.node.name}
        </h2>
      </div>
      <div className="space-y-4 p-4">
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
      <div className="mt-auto border-t p-3">
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
