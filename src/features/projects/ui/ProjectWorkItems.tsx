import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import {
  type ProjectItem,
  type ProjectResult,
  type ProjectStatus,
  type ProjectWorkspace,
  projectItemTitleMaxLength,
  projectStatuses,
  type UpdateProjectItemInput,
} from "../contracts";
import { ProjectTitleDialog } from "./ProjectTitleDialog";
import type { ProjectsTranslator } from "./projectMessages";

export type ProjectItemChanges = Pick<UpdateProjectItemInput, "title" | "status" | "assigneeId">;

type WorkItemsProps = {
  workspace: ProjectWorkspace;
  labels: ProjectsTranslator;
  pending: boolean;
  updateItem: (
    item: ProjectItem,
    changes: ProjectItemChanges,
    report?: boolean,
  ) => Promise<ProjectResult<ProjectWorkspace>>;
};

type WorkItemProps = WorkItemsProps & { item: ProjectItem };

const statusColor = {
  todo: "bg-muted-foreground",
  "in-progress": "bg-primary",
  done: "bg-success",
} satisfies Record<ProjectStatus, string>;

function ItemTitle({ workspace, item, pending, labels, updateItem }: WorkItemProps) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <span className="min-w-0 py-1 text-sm font-medium [overflow-wrap:anywhere]">
        <bdi>{item.title}</bdi>
      </span>
      {workspace.canEdit && (
        <ProjectTitleDialog
          labels={labels}
          title={labels("workspace.editTitle")}
          description={labels("workspace.editDescription")}
          field={labels("workspace.itemTitle")}
          maxLength={projectItemTitleMaxLength}
          pending={pending}
          initialTitle={item.title}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              aria-label={labels("workspace.edit", { title: item.title })}
              disabled={pending}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          }
          submit={(title) => updateItem(item, { title }, false)}
        />
      )}
    </div>
  );
}

function ItemStatus({ workspace, item, labels, pending, updateItem }: WorkItemProps) {
  if (!workspace.canEdit) {
    return (
      <Badge variant={item.status === "done" ? "success" : "secondary"}>
        {labels(`status.${item.status}`)}
      </Badge>
    );
  }
  return (
    <Select
      ariaLabel={labels("workspace.status", { title: item.title })}
      value={item.status}
      disabled={pending}
      options={projectStatuses.map((status) => ({
        value: status,
        label: labels(`status.${status}`),
      }))}
      onChange={(value) => {
        const status = projectStatuses.find((candidate) => candidate === value);
        if (status !== undefined && status !== item.status) {
          void updateItem(item, { status });
        }
      }}
    />
  );
}

function ItemAssignee({ workspace, item, labels, pending, updateItem }: WorkItemProps) {
  const unassigned = labels("workspace.unassigned");
  const eligible = workspace.assignees.find(({ id }) => id === item.assigneeId);
  const historical =
    workspace.project.owner.id === item.assigneeId
      ? workspace.project.owner
      : workspace.members.find(({ person }) => person.id === item.assigneeId)?.person;
  if (!workspace.canAssign) {
    return (
      <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        <bdi>{eligible?.name ?? historical?.name ?? unassigned}</bdi>
      </span>
    );
  }
  return (
    <Select
      ariaLabel={labels("workspace.assignee", { title: item.title })}
      value={item.assigneeId ?? ""}
      contentClassName={`${BLOCK_CLASS} ph-no-capture`}
      triggerContent={
        eligible === undefined && historical !== undefined ? (
          <bdi>{historical.name}</bdi>
        ) : undefined
      }
      disabled={pending}
      options={[
        { value: "", label: unassigned },
        ...workspace.assignees.map(({ id, name }) => ({ value: id, label: name })),
      ]}
      onChange={(id) => void updateItem(item, { assigneeId: id === "" ? null : id })}
    />
  );
}

export function ProjectWorkItemList(props: WorkItemsProps) {
  const { workspace, labels } = props;
  if (workspace.items.length === 0) {
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("workspace.empty")}
        body={labels("workspace.emptyDescription")}
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[28rem] table-fixed text-start text-sm">
        <thead className="border-b bg-muted/40 text-muted-foreground">
          <tr>
            <th scope="col" className="w-[46%] px-4 py-2.5 text-start font-medium">
              {labels("workspace.titleColumn")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-medium">
              {labels("workspace.statusColumn")}
            </th>
            <th scope="col" className="px-3 py-2.5 text-start font-medium">
              {labels("workspace.assigneeColumn")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {workspace.items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-2.5">
                <ItemTitle {...props} item={item} />
              </td>
              <td className="px-3 py-2.5">
                <ItemStatus {...props} item={item} />
              </td>
              <td className="px-3 py-2.5">
                <ItemAssignee {...props} item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardCard(props: WorkItemProps) {
  const { item, labels, workspace, pending } = props;
  const { attributes, listeners, transform, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: item.id, disabled: pending || !workspace.canEdit });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "space-y-2 rounded-md border bg-card p-3",
        isDragging && "relative z-10 opacity-80 shadow-md",
      )}
    >
      <div className="flex min-w-0 gap-1.5">
        {workspace.canEdit && (
          <Button
            {...attributes}
            {...listeners}
            ref={setActivatorNodeRef}
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-label={labels("workspace.drag", { title: item.title })}
            disabled={pending}
            tabIndex={-1}
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <ItemTitle {...props} />
        </div>
      </div>
      {workspace.canEdit && <ItemStatus {...props} />}
      <ItemAssignee {...props} />
    </li>
  );
}

function BoardColumn({ status, ...props }: WorkItemsProps & { status: ProjectStatus }) {
  const { labels, workspace, pending } = props;
  const title = labels(`status.${status}`);
  const cards = workspace.items.filter((item) => item.status === status);
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    disabled: pending || !workspace.canEdit,
  });
  return (
    <section
      aria-label={title}
      ref={setNodeRef}
      className={cn(
        "min-h-60 rounded-lg border bg-muted/40 p-2.5 transition-colors",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1 py-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", statusColor[status])}
          />
          {title}
        </h2>
        <Badge variant="outline">{labels("workspace.columnCount", { count: cards.length })}</Badge>
      </div>
      {cards.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {labels("workspace.emptyColumn")}
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((item) => (
            <BoardCard key={item.id} {...props} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProjectWorkItemBoard(props: WorkItemsProps) {
  const { workspace, labels, pending, updateItem } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const itemById = (id: string | number) => workspace.items.find((item) => item.id === id);
  const statusById = (id: string | number | undefined) =>
    projectStatuses.find((status) => status === id);

  function move({ active, over }: DragEndEvent) {
    if (pending || !workspace.canEdit) return;
    const item = itemById(active.id);
    const status = statusById(over?.id);
    if (item !== undefined && status !== undefined && status !== item.status) {
      void updateItem(item, { status });
    }
  }

  function describeDrop(
    key: "workspace.dragOver" | "workspace.dragEnd",
    id: string | number,
    target: string | number | undefined,
  ) {
    const item = itemById(id);
    const status = statusById(target);
    if (item !== undefined && status !== undefined) {
      return labels(key, { title: item.title, status: labels(`status.${status}`) });
    }
  }

  return (
    <DndContext
      id={`project-board-${workspace.project.id}`}
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={move}
      accessibility={{
        screenReaderInstructions: { draggable: labels("workspace.dragInstructions") },
        announcements: {
          onDragStart: ({ active }) => {
            const item = itemById(active.id);
            if (item !== undefined) return labels("workspace.dragStart", { title: item.title });
          },
          onDragOver: ({ active, over }) => describeDrop("workspace.dragOver", active.id, over?.id),
          onDragEnd: ({ active, over }) => describeDrop("workspace.dragEnd", active.id, over?.id),
          onDragCancel: () => labels("workspace.dragCancel"),
        },
      }}
    >
      <div className="grid auto-cols-[minmax(14rem,1fr)] grid-flow-col items-start gap-3 overflow-x-auto pb-2">
        {projectStatuses.map((status) => (
          <BoardColumn key={status} {...props} status={status} />
        ))}
      </div>
    </DndContext>
  );
}
