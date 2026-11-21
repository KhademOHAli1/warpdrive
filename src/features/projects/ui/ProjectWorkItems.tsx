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
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import {
  type ProjectItem,
  type ProjectResult,
  type ProjectWorkspace,
  projectItemKey,
  projectItemTitleMaxLength,
  type UpdateProjectItemInput,
} from "../contracts";
import type { PlanningViewDisplay, WorkspacePlanning } from "../planning/contracts";
import { ProjectItemStructureBadges } from "./ProjectItemStructure";
import { ProjectTitleDialog } from "./ProjectTitleDialog";
import type { ProjectsTranslator } from "./projectMessages";
import { workflowStateLabel } from "./projectWorkflowUi";
import { projectWorkItemGroups, type WorkItemGroup } from "./projectWorkItemGroups";
import { useProjectFormatters } from "./useProjectFormatters";

export type ProjectItemChanges = Omit<UpdateProjectItemInput, "projectId" | "itemId" | "revision">;

export type WorkItemsProps = {
  workspace: ProjectWorkspace;
  labels: ProjectsTranslator;
  pending: boolean;
  openItem: (id: string, trigger: HTMLElement) => void;
  display?: PlanningViewDisplay;
  planning?: WorkspacePlanning;
  setItemPlanning?: (
    itemId: string,
    patch: { cycleId?: string | null; moduleIds?: string[] },
  ) => void;
  createInColumn?: (group: WorkItemGroup) => ReactNode;
  updateItem: (
    item: ProjectItem,
    changes: ProjectItemChanges,
    report?: boolean,
  ) => Promise<ProjectResult<ProjectWorkspace>>;
};

type BoardDestination = { group: WorkItemGroup; key: string; lane: string };
type BoardInteraction = { canGroup: boolean; destination: BoardDestination; repeated: boolean };
type WorkItemProps = WorkItemsProps & { item: ProjectItem };

function ItemTitle({
  workspace,
  item,
  pending,
  labels,
  updateItem,
  openItem,
  display,
}: WorkItemProps) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <button
        type="button"
        className="min-w-0 rounded-sm py-1 text-start text-sm font-medium [overflow-wrap:anywhere] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => openItem(item.id, event.currentTarget)}
        aria-label={item.title}
      >
        {display?.showKey !== false && (
          <bdi
            className="me-2 whitespace-nowrap text-xs font-normal text-muted-foreground"
            dir="ltr"
          >
            {projectItemKey(workspace.project.identifier, item.sequenceNumber)}
          </bdi>
        )}
        <bdi>{item.title}</bdi>
      </button>
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

export function ItemStatus({ workspace, item, labels, pending, updateItem }: WorkItemProps) {
  const state = workspace.states.find(({ id }) => id === item.stateId);
  if (!workspace.canEdit) {
    return (
      <Badge variant={item.status === "done" ? "success" : "secondary"}>
        {state === undefined ? labels(`status.${item.status}`) : workflowStateLabel(state, labels)}
      </Badge>
    );
  }
  return (
    <Select
      ariaLabel={labels("workspace.status", { title: item.title })}
      value={item.stateId}
      disabled={pending}
      options={workspace.states.map((state) => ({
        value: state.id,
        label: workflowStateLabel(state, labels),
      }))}
      onChange={(stateId) => {
        if (stateId !== item.stateId) void updateItem(item, { stateId });
      }}
    />
  );
}

export function ItemAssignee({ workspace, item, labels, pending, updateItem }: WorkItemProps) {
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

function ItemDate({ value }: { value: string | null }) {
  const format = useProjectFormatters();
  return value === null ? "—" : <time dateTime={value}>{format.dateOnly(value)}</time>;
}

export function ProjectWorkItemList(props: WorkItemsProps) {
  const { workspace, labels, display } = props;
  const format = useProjectFormatters();
  if (workspace.items.length === 0 && display?.showEmptyGroups !== true) {
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("workspace.empty")}
        body={labels("workspace.emptyDescription")}
      />
    );
  }
  const groupBy = display?.groupBy ?? "state";
  const columns = [
    {
      key: "titleColumn",
      visible: true,
      render: (item: ProjectItem) => (
        <div className="space-y-1">
          <ItemTitle {...props} item={item} />
          <ProjectItemStructureBadges
            item={item}
            catalog={workspace.workStructure}
            labels={labels}
            showLabels={display?.showLabels}
            showEstimate={display?.showEstimate}
          />
        </div>
      ),
    },
    {
      key: "statusColumn",
      visible: display?.showStatus !== false,
      render: (item: ProjectItem) => <ItemStatus {...props} item={item} />,
    },
    {
      key: "assigneeColumn",
      visible: display?.showAssignee ?? true,
      render: (item: ProjectItem) => <ItemAssignee {...props} item={item} />,
    },
    {
      key: "priority",
      visible: display?.showPriority ?? true,
      render: (item: ProjectItem) => <ItemPriority item={item} labels={labels} />,
    },
    {
      key: "startDate",
      visible: display?.showStartDate === true,
      render: (item: ProjectItem) => <ItemDate value={item.startDate} />,
    },
    {
      key: "dueDate",
      visible: display?.showDueDate ?? true,
      render: (item: ProjectItem) => <ItemDate value={item.dueDate} />,
    },
  ] as const;
  const visible = columns.filter(({ visible }) => visible);
  const groups = projectWorkItemGroups(workspace, labels, groupBy, props.planning).filter(
    ({ items }) => items.length > 0 || display?.showEmptyGroups === true,
  );
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[40rem] table-fixed text-start text-sm">
        <thead className="border-b bg-muted/40 text-muted-foreground">
          <tr>
            {visible.map(({ key }) => (
              <th
                scope="col"
                key={key}
                className={cn(
                  "px-3 py-2.5 text-start font-medium",
                  key === "titleColumn" && "w-[32%] px-4",
                )}
              >
                {labels(`workspace.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id} className="divide-y border-b last:border-b-0">
            {groupBy !== "none" && (
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={visible.length}
                  className="bg-muted/30 px-4 py-2 text-start font-medium"
                >
                  {group.state !== undefined && (
                    <span
                      aria-hidden="true"
                      className="me-2 inline-block size-2 rounded-full"
                      style={{ backgroundColor: group.state.color }}
                    />
                  )}
                  {group.title}
                  <span className="ms-2 text-xs text-muted-foreground">
                    {format.number(group.items.length)}
                  </span>
                </th>
              </tr>
            )}
            {group.items.map((item) => (
              <tr key={item.id}>
                {visible.map(({ key, render }) => (
                  <td key={key} className={cn("px-3 py-2.5", key === "titleColumn" && "px-4")}>
                    {render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function ItemPriority({ item, labels }: Pick<WorkItemProps, "item" | "labels">) {
  return (
    <Badge
      variant="outline"
      className={cn(item.priority === "urgent" && "border-destructive/50 text-destructive")}
    >
      {labels(`priority.${item.priority}`)}
    </Badge>
  );
}

function BoardCard(props: WorkItemProps & BoardInteraction) {
  const { item, labels, workspace, pending, display, canGroup, destination, repeated } = props;
  const { attributes, listeners, transform, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: repeated ? `${destination.key}:${item.id}` : item.id,
      data: { itemId: item.id, from: destination.key },
      disabled: pending || !workspace.canEdit || !canGroup,
    });
  const format = useProjectFormatters();
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
        {workspace.canEdit && canGroup && (
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
      {workspace.canEdit && display?.showStatus !== false && <ItemStatus {...props} />}
      {display?.showAssignee !== false && <ItemAssignee {...props} />}
      <ProjectItemStructureBadges
        item={item}
        catalog={workspace.workStructure}
        labels={labels}
        showLabels={display?.showLabels}
        showEstimate={display?.showEstimate}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {display?.showPriority !== false && <ItemPriority item={item} labels={labels} />}
        {display?.showStartDate === true && item.startDate !== null && (
          <time dateTime={item.startDate} className="text-xs text-muted-foreground">
            {format.dateOnly(item.startDate)}
          </time>
        )}
        {display?.showDueDate !== false && item.dueDate !== null && (
          <time dateTime={item.dueDate} className="text-xs text-muted-foreground">
            {format.dateOnly(item.dueDate)}
          </time>
        )}
      </div>
    </li>
  );
}

function BoardColumn({
  destination,
  canGroup,
  repeated,
  ...props
}: WorkItemsProps & BoardInteraction) {
  const { group, key } = destination;
  const { labels, workspace, pending } = props;
  const { title, items: cards, state } = group;
  const { setNodeRef, isOver } = useDroppable({
    id: key,
    disabled: pending || !workspace.canEdit || !canGroup,
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
          {state !== undefined && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: state.color }}
            />
          )}
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <Badge variant="outline">
            {labels("workspace.columnCount", { count: cards.length })}
          </Badge>
          {props.createInColumn?.(group)}
        </div>
      </div>
      {cards.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {labels("workspace.emptyColumn")}
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((item) => (
            <BoardCard
              key={item.id}
              {...props}
              item={item}
              canGroup={canGroup}
              destination={destination}
              repeated={repeated}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function boardLanes({ workspace, display, labels, planning }: WorkItemsProps) {
  const primary = display?.groupBy ?? "state";
  const secondary = display?.subGroupBy ?? "none";
  const lanes = projectWorkItemGroups(workspace, labels, secondary, planning);
  return lanes
    .filter(({ items }) => secondary === "none" || items.length > 0)
    .map((lane) => ({
      ...lane,
      columns: projectWorkItemGroups({ ...workspace, items: lane.items }, labels, primary, planning)
        .filter(
          ({ items }) =>
            items.length > 0 || display?.showEmptyGroups !== false || primary === "none",
        )
        .map((group) => ({
          group,
          key: secondary === "none" ? group.id : `${lane.id}:${group.id}`,
          lane: lane.id,
        })),
    }));
}

function changedMembership(current: string[], value: string | null, from?: string | null) {
  if (value === null) return [];
  return [...new Set([...current.filter((id) => id !== from), value])];
}

function changePlanningGroup(
  props: WorkItemsProps,
  item: ProjectItem,
  kind: "cycle" | "module",
  value: string | null,
  from?: string | null,
) {
  const choices = kind === "cycle" ? props.planning?.cycles : props.planning?.modules;
  if (
    value !== null &&
    choices?.some(({ id, acceptsWork }) => id === value && acceptsWork) !== true
  )
    return;
  const assignment = props.planning?.assignments.find(({ itemId }) => item.id === itemId);
  if (kind === "cycle") props.setItemPlanning?.(item.id, { cycleId: value });
  else
    props.setItemPlanning?.(item.id, {
      moduleIds: changedMembership(assignment?.moduleIds ?? [], value, from),
    });
}

function moveCard(
  props: WorkItemsProps,
  item: ProjectItem,
  target: WorkItemGroup,
  from?: WorkItemGroup,
) {
  if (target.state !== undefined) {
    if (target.state.id !== item.stateId) void props.updateItem(item, { stateId: target.state.id });
    return;
  }
  if (target.priority !== undefined) {
    if (target.priority !== item.priority)
      void props.updateItem(item, { priority: target.priority });
    return;
  }
  const relation = target.related;
  if (relation === undefined) return;
  const { kind, value } = relation;
  const previous = from?.related?.value;
  switch (kind) {
    case "assignee":
      if (value === null || props.workspace.assignees.some(({ id }) => id === value))
        void props.updateItem(item, { assigneeId: value });
      break;
    case "label":
      void props.updateItem(item, { labelIds: changedMembership(item.labelIds, value, previous) });
      break;
    case "cycle":
    case "module":
      changePlanningGroup(props, item, kind, value, previous);
      break;
    case "creator":
      break;
  }
}

export function ProjectWorkItemBoard(props: WorkItemsProps) {
  const { workspace, labels, pending, display } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const primary = display?.groupBy ?? "state";
  const secondary = display?.subGroupBy ?? "none";
  const lanes = boardLanes(props);
  const columns = lanes.flatMap((lane) => lane.columns);
  const byKey = (key: unknown) => columns.find((column) => column.key === key);
  const repeated = secondary !== "none" || primary === "label" || primary === "module";
  const canGroup =
    primary !== "none" && primary !== "creator" && (primary !== "assignee" || workspace.canAssign);
  const draggedItem = ({ id, data }: DragEndEvent["active"]) =>
    workspace.items.find((item) => item.id === (data.current?.itemId ?? id));

  function move({ active, over }: DragEndEvent) {
    if (pending || !workspace.canEdit || !canGroup) return;
    const item = draggedItem(active);
    const target = byKey(over?.id);
    if (item === undefined || target === undefined) return;
    const from = byKey(active.data.current?.from);
    if (from?.key === target.key || (from !== undefined && from.lane !== target.lane)) return;
    moveCard(props, item, target.group, from?.group);
  }

  function describeDrop(
    key: "workspace.dragOver" | "workspace.dragEnd",
    active: DragEndEvent["active"],
    target: string | number | undefined,
  ) {
    const item = draggedItem(active);
    const group = byKey(target)?.group;
    if (item !== undefined && group !== undefined)
      return labels(key, { title: item.title, status: group.title });
  }

  if (columns.length === 0)
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("workspace.empty")}
        body={labels("workspace.emptyDescription")}
      />
    );
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
            const item = draggedItem(active);
            if (item !== undefined) return labels("workspace.dragStart", { title: item.title });
          },
          onDragOver: ({ active, over }) => describeDrop("workspace.dragOver", active, over?.id),
          onDragEnd: ({ active, over }) => describeDrop("workspace.dragEnd", active, over?.id),
          onDragCancel: () => labels("workspace.dragCancel"),
        },
      }}
    >
      <div className="space-y-3">
        {lanes.map((lane) => (
          <div key={lane.id}>
            {secondary !== "none" && (
              <h2 className="mb-2 text-sm font-semibold">
                <bdi>{lane.title}</bdi>
              </h2>
            )}
            <div className="grid auto-cols-[minmax(14rem,1fr)] grid-flow-col items-start gap-3 overflow-x-auto pb-2">
              {lane.columns.map((column) => (
                <BoardColumn
                  key={column.key}
                  {...props}
                  destination={column}
                  repeated={repeated}
                  canGroup={canGroup}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </DndContext>
  );
}
