import { err, ok } from "@/types/result";
import type {
  ProjectCommands,
  ProjectFailure,
  ProjectIndex,
  ProjectItem,
  ProjectMembership,
  ProjectPerson,
  ProjectSummary,
  ProjectWorkspace,
} from "../contracts";
import {
  createProjectInput,
  createProjectItemInput,
  initialProjectItemContent,
  matchesInitialProjectItemContent,
  setProjectMemberInput,
  updateProjectItemInput,
  validProjectItemDates,
} from "../input";

export const fixtureProjectId = "cf761674-6fce-4c84-a13e-693c2dcc0325";
export const fixtureEditorId = "669004ee-2320-40cf-8e62-23dd5100825b";
const owner = { id: "74207b95-4ded-4818-987b-c1e5b6d16629", name: "Alex Morgan" };
const editor = { id: fixtureEditorId, name: "Jules Kim" };
const viewer = { id: "a5280626-a7b8-45a8-9f77-f0cd32051faa", name: "Sam Rivera" };
const staff = [editor, viewer, { id: "d9f553df-9a76-488c-a4b9-cc4c90e747d6", name: "Pat Stone" }];

type FixtureProject = {
  project: ProjectSummary;
  items: ProjectItem[];
  members: ProjectMembership[];
};

const accept = <T>(value: T) => Promise.resolve(ok(value));
const refuse = (error: ProjectFailure) => Promise.resolve(err(error));

export function createProjectsFixture() {
  const projects = new Map<string, FixtureProject>([
    [
      fixtureProjectId,
      {
        project: {
          id: fixtureProjectId,
          title: "Office move",
          owner,
          createdAt: "2026-11-10T12:00:00.000Z",
        },
        members: [
          { person: editor, role: "editor", canAssign: true },
          { person: viewer, role: "viewer", canAssign: false },
        ],
        items: [
          {
            id: "5358f615-4145-479d-9db9-fc7a48d1987d",
            title: "Check network outlets",
            status: "todo",
            assigneeId: null,
            priority: "none",
            startDate: null,
            dueDate: null,
            description: "",
            createdBy: null,
            revision: 0,
          },
          {
            id: "908c9312-e974-487b-afc4-74c553d5f688",
            title: "Confirm moving date",
            status: "in-progress",
            assigneeId: editor.id,
            priority: "medium",
            startDate: "2026-11-10",
            dueDate: "2026-11-30",
            description: "Confirm when the lift and loading zone are available.",
            createdBy: editor.id,
            revision: 0,
          },
        ],
      },
    ],
  ]);

  function snapshot(project: FixtureProject): ProjectWorkspace {
    const assignees: ProjectPerson[] = [owner, ...project.members.map(({ person }) => person)];
    return structuredClone({
      ...project,
      assignees,
      staff,
      canEdit: true,
      canAssign: true,
      canManageMembers: true,
    });
  }

  const commands: ProjectCommands = {
    createProject(raw) {
      const parsed = createProjectInput.safeParse(raw);
      if (!parsed.success) return refuse("project_invalid");
      const { id, title } = parsed.data;
      const existing = projects.get(id);
      if (existing) {
        return existing.project.title === title
          ? accept(structuredClone(existing.project))
          : refuse("project_conflict");
      }
      const project = { id, title, owner, createdAt: new Date().toISOString() };
      projects.set(id, { project, items: [], members: [] });
      return accept(structuredClone(project));
    },
    createItem(raw) {
      const parsed = createProjectItemInput.safeParse(raw);
      if (!parsed.success) return refuse("project_invalid");
      const { projectId, id } = parsed.data;
      const project = projects.get(projectId);
      if (!project) return refuse("project_unavailable");
      const content = initialProjectItemContent(parsed.data);
      const { assigneeId } = content;
      if (assigneeId !== null && !snapshot(project).assignees.some(({ id }) => id === assigneeId)) {
        return refuse("project_invalid");
      }
      const existing = project.items.find((item) => item.id === id);
      if (existing) {
        return existing.revision > 0 || matchesInitialProjectItemContent(existing, content)
          ? accept(snapshot(project))
          : refuse("project_conflict");
      }
      project.items.push({ ...content, id, createdBy: owner.id, revision: 0 });
      return accept(snapshot(project));
    },
    updateItem(raw) {
      const parsed = updateProjectItemInput.safeParse(raw);
      if (!parsed.success) return refuse("project_invalid");
      const { projectId, itemId, revision, ...content } = parsed.data;
      const { assigneeId } = content;
      const project = projects.get(projectId);
      const item = project?.items.find(({ id }) => id === itemId);
      if (!project || !item) return refuse("project_unavailable");
      if (item.revision !== revision || revision === Number.MAX_SAFE_INTEGER)
        return refuse("project_conflict");
      const startDate = content.startDate === undefined ? item.startDate : content.startDate;
      const dueDate = content.dueDate === undefined ? item.dueDate : content.dueDate;
      if (!validProjectItemDates(startDate, dueDate)) return refuse("project_invalid");
      if (assigneeId != null && !snapshot(project).assignees.some(({ id }) => id === assigneeId)) {
        return refuse("project_invalid");
      }
      item.title = content.title ?? item.title;
      item.status = content.status ?? item.status;
      item.priority = content.priority ?? item.priority;
      item.description = content.description ?? item.description;
      item.startDate = startDate;
      item.dueDate = dueDate;
      if (assigneeId !== undefined) item.assigneeId = assigneeId;
      item.revision += 1;
      return accept(snapshot(project));
    },
    setMember(raw) {
      const parsed = setProjectMemberInput.safeParse(raw);
      if (!parsed.success) return refuse("project_invalid");
      const { projectId, userId, membership } = parsed.data;
      const project = projects.get(projectId);
      if (!project) return refuse("project_unavailable");
      const person = staff.find(({ id }) => id === userId);
      if (!person) return refuse("project_invalid");
      project.members = project.members.filter(({ person }) => person.id !== userId);
      if (membership) {
        project.members.push({ person, ...membership });
      } else {
        for (const item of project.items) {
          if (item.assigneeId === userId) {
            item.assigneeId = null;
            item.revision += 1;
          }
        }
      }
      return accept(snapshot(project));
    },
  };

  return {
    commands,
    index(): ProjectIndex {
      return {
        canCreate: true,
        projects: [...projects.values()].map(({ project }) => structuredClone(project)),
      };
    },
    workspace(projectId: string) {
      const project = projects.get(projectId);
      return project ? snapshot(project) : undefined;
    },
  };
}
