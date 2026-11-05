"use client";
import { Variable } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { BlockVariablePicker } from "@/features/blocks/ui/BlockVariablePicker";
import { RichTextBody } from "@/features/email/composer/RichTextBodyLazy";
import { StudioBound, StudioFixed, StudioToggle } from "./StudioFormControls";
import { fieldCatalog, type StudioFormProps } from "./studioFormTypes";
import { asObject, studioVariables, textValue } from "./studioModel";

function EmailBody(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<{ text: string; seq: number }>();
  const body = asObject(props.node.config.bodyHtml);
  const template = body.kind === "template";
  const html = template ? textValue(body.template) : textValue(props.node.config.bodyHtml);
  const variables = studioVariables(props.definition, props.node.id, fieldCatalog(props.studio), {
    wholeRecord: L.types.record ?? "",
    wholeList: L.types.array ?? "",
    output: L.trigger,
  });
  return (
    <BlockField label={L.fields.body ?? ""}>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          aria-label={`${L.chooseVariable}: ${L.fields.body}`}
          onClick={() => setOpen(true)}
        >
          <Variable className="size-3.5" aria-hidden />
        </Button>
      </div>
      <RichTextBody
        key={props.node.id}
        html={html}
        readOnly={props.disabled}
        ariaLabel={L.fields.body}
        insertToken={token}
        frameClassName="rounded-md border"
        onChange={(next) =>
          props.onChange({
            ...props.node.config,
            bodyHtml: template
              ? { kind: "template", template: next, variables: asObject(body.variables) }
              : { kind: "literal", value: next },
          })
        }
      />
      <BlockVariablePicker
        open={open}
        onOpenChange={setOpen}
        choices={variables.choices.filter(
          (choice) => !["object", "array", "record"].includes(choice.type),
        )}
        onChoose={(id) => {
          const reference = variables.references.get(id);
          if (reference === undefined) return;
          const key = `value_${Object.keys(asObject(body.variables)).length + 1}`;
          props.onChange({
            ...props.node.config,
            bodyHtml: {
              kind: "template",
              template: html,
              variables: {
                ...asObject(body.variables),
                [key]: { kind: "reference", nodeId: reference.nodeId, path: reference.path },
              },
            },
          });
          setToken((previous) => ({ text: `{{${key}}}`, seq: (previous?.seq ?? 0) + 1 }));
        }}
      />
    </BlockField>
  );
}
// Keep existing provider-only fields editable so legacy drafts can clear them.
function hasCalendarProviderInput(value: BlockJson | undefined): boolean {
  return value !== undefined && value !== false && (!Array.isArray(value) || value.length > 0);
}

export function StudioCommunicationFields(
  props: StudioFormProps & {
    kind: "SEND_EMAIL" | "DRAFT_EMAIL" | "CREATE_CALENDAR_EVENT" | "SEND_CHAT_MESSAGE";
  },
) {
  const L = useSharedBlocksMessages();
  switch (props.kind) {
    case "SEND_EMAIL":
    case "DRAFT_EMAIL":
      return (
        <>
          <StudioFixed
            {...props}
            name="accountId"
            label={L.fields.account}
            options={[
              { value: "", label: L.noAccount },
              ...props.studio.accounts.map((account) => ({
                value: account.id,
                label: account.label,
              })),
            ]}
          />
          <StudioBound {...props} name="to" type="array" />
          <StudioBound {...props} name="cc" type="array" />
          <StudioBound {...props} name="bcc" type="array" />
          <StudioBound {...props} name="subject" />
          <EmailBody {...props} />
          <StudioBound {...props} name="attachments" label={L.fields.attachments} type="array" />
          <StudioBound {...props} name="threadId" label={L.fields.replyTo} />
        </>
      );
    case "CREATE_CALENDAR_EVENT":
      return (
        <>
          <BlockField label={L.fields.location ?? ""}>
            <p className="text-xs">{L.calendarDestination}</p>
          </BlockField>
          <StudioBound {...props} name="title" />
          <StudioBound {...props} name="startsAt" type="instant" />
          <StudioBound {...props} name="endsAt" type="instant" />
          <StudioToggle {...props} name="allDay" label={L.fields.fullDay} />
          <StudioBound {...props} name="description" multiline />
          <StudioBound {...props} name="location" />
          <StudioBound {...props} name="timeZone" />
          {hasCalendarProviderInput(props.node.config.attendeeEmails) && (
            <StudioBound {...props} name="attendeeEmails" label={L.fields.attendees} type="array" />
          )}
          {hasCalendarProviderInput(props.node.config.sendInvitations) && (
            <StudioToggle {...props} name="sendInvitations" />
          )}
          {hasCalendarProviderInput(props.node.config.createConference) && (
            <StudioToggle {...props} name="createConference" label={L.fields.addConferencing} />
          )}
        </>
      );
    case "SEND_CHAT_MESSAGE":
      return (
        <>
          <StudioFixed
            {...props}
            name="recipientId"
            label={L.fields.member}
            options={[
              { value: "", label: L.fields.member ?? "" },
              ...props.studio.members.map((member) => ({ value: member.id, label: member.label })),
            ]}
          />
          <StudioBound {...props} name="title" />
          <StudioBound {...props} name="message" label={L.fields.body} multiline />
          <StudioToggle {...props} name="requireApproval" label={L.approval} />
        </>
      );
  }
}
