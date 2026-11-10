"use client";

import { z } from "zod";
import { trpc } from "@/lib/trpc-client";
import type { ConfigurationValidation } from "../configurationTypes";
import type { WorkflowNode } from "../schemas";
import { type RecordLookupEntity, recordPickDraftConfig } from "../workflowRecordQueryContract";
import { libraryReadDenied } from "./libraryErrors";
import { PickRecordConfigurationFields } from "./PickRecordConfigurationFields";
import { useWorkflowConfigurationReferences } from "./useWorkflowConfigurationReferences";

interface Props {
  node: WorkflowNode;
  workflowId?: string;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}

function usePickSelected(workflowId: string, entity: RecordLookupEntity, ids: string[]) {
  const selector = { kind: "record", entity } as const;
  const enabled = z.uuid().safeParse(workflowId).success && ids.length > 0;
  const query = trpc.workflows.configurationReferences.useQuery(
    { workflowId, type: "record.pick", version: 1, field: selector, mode: "selected", ids },
    { enabled, refetchOnMount: "always", retry: false, staleTime: 0 },
  );
  const data = query.data;
  if (!enabled) return { status: "ready" as const, items: [] };
  if (query.isError)
    return {
      status: libraryReadDenied(query.error) ? ("denied" as const) : ("error" as const),
      items: [],
    };
  if (query.isFetching || data?.state !== "page") return { status: "loading" as const, items: [] };
  const matching =
    data.type === "record.pick" &&
    data.workflowId === workflowId &&
    z.literal(1).safeParse(data.version).success &&
    data.mode === "selected" &&
    data.query === "" &&
    data.field.kind === "record" &&
    data.field.entity === entity;
  return matching
    ? { status: "ready" as const, items: data.items.filter((item) => ids.includes(item.id)) }
    : { status: "error" as const, items: [] };
}

function ConfiguredPick(props: Props & { entity: RecordLookupEntity; ids: string[] }) {
  const { workflowId, entity, ids, editable } = props;
  const read = useWorkflowConfigurationReferences({
    workflowId,
    type: "record.pick",
    selector: { kind: "record", entity },
    enabled: editable,
  });
  const selected = usePickSelected(workflowId ?? "", entity, ids);
  return (
    <PickRecordConfigurationFields
      {...props}
      read={{
        search: read.search,
        onSearch: read.onSearch,
        status: selected.status === "ready" && editable ? read.status : selected.status,
        options: read.options,
        selected: selected.items,
        nextCursor: read.nextCursor,
        onMore: read.onMore,
      }}
    />
  );
}

export function PickRecordFieldsWithLookup(props: Props) {
  const parsed = recordPickDraftConfig.safeParse(props.node.config);
  const entity = parsed.success ? parsed.data.entity : undefined;
  if (entity === undefined || !parsed.success) return <PickRecordConfigurationFields {...props} />;
  return (
    <ConfiguredPick key={entity} {...props} entity={entity} ids={parsed.data.recordIds ?? []} />
  );
}
