import { getSchema } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { prosemirrorToYDoc, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { JSDOM } from "jsdom";
import * as Y from "yjs";
import { projectDocumentBodyMaxLength } from "../contracts";
import {
  projectDocumentCollaborationFragment as fragment,
  type ProjectDocumentCollaborationInput,
  projectDocumentCollaborationMaxBytes,
  projectDocumentStateVectorMaxBytes,
} from "./contracts";
import { isProjectDocumentLink, projectDocumentExtensions } from "./editor";
import { projectDocumentHtml } from "./html";

// Plane Community v1.5.0 also uses TipTap's ProseMirror/Yjs bridge. Warpdrive
// implements its own typed HTTP synchronization and durable authorization.
const schema = getSchema(projectDocumentExtensions(true));
const dom = new JSDOM().window.document;

class InvalidCollaborationData extends Error {}

function seedDocument(html: string) {
  const body = dom.createElement("div");
  body.innerHTML = projectDocumentHtml(html);
  return prosemirrorToYDoc(DOMParser.fromSchema(schema).parse(body), fragment);
}

function decodeBase64(value: string, maxBytes: number) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > maxBytes || bytes.toString("base64") !== value)
    throw new InvalidCollaborationData("Invalid collaboration payload");
  return bytes;
}

function verifyAttributes(name: string, attrs: Record<string, unknown>) {
  if (
    Object.values(attrs).some(
      (value) =>
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean",
    )
  )
    throw new InvalidCollaborationData("Invalid collaboration attributes");
  if (
    name === "link" &&
    (typeof attrs.href !== "string" ||
      !isProjectDocumentLink(attrs.href) ||
      (attrs.target !== null && attrs.target !== undefined) ||
      (attrs.class !== null && attrs.class !== undefined))
  )
    throw new InvalidCollaborationData("Invalid collaboration link");
}

function serializeDocument(doc: Y.Doc) {
  if (doc.share.size !== 1 || doc.store.pendingStructs !== null || doc.store.pendingDs !== null)
    throw new InvalidCollaborationData("Invalid collaboration structure");
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(fragment), schema);
  root.check();
  root.descendants((node) => {
    verifyAttributes(node.type.name, node.attrs);
    for (const mark of node.marks) verifyAttributes(mark.type.name, mark.attrs);
  });
  if (
    root.childCount === 1 &&
    root.firstChild?.isTextblock === true &&
    root.firstChild.content.size === 0 &&
    root.firstChild.type.name === "paragraph"
  )
    return "";
  const body = dom.createElement("div");
  body.append(DOMSerializer.fromSchema(schema).serializeFragment(root.content, { document: dom }));
  const html = projectDocumentHtml(body.innerHTML);
  if (Buffer.byteLength(html) > projectDocumentBodyMaxLength)
    throw new InvalidCollaborationData("Page content exceeds its collaboration limit");
  return html;
}

export type MergedProjectDocument = {
  initialState: Buffer | null;
  change: { state: Buffer; bodyHtml: string } | null;
  update: string;
};

export function mergeProjectDocument(
  state: Buffer | null,
  bodyHtml: string,
  input: Pick<ProjectDocumentCollaborationInput, "stateVector" | "update">,
): MergedProjectDocument | null {
  const doc = state === null ? seedDocument(bodyHtml) : new Y.Doc();
  try {
    doc.getXmlFragment(fragment);
    if (state !== null) Y.applyUpdate(doc, state);
    const initialState = state === null ? Buffer.from(Y.encodeStateAsUpdate(doc)) : null;
    let change: MergedProjectDocument["change"] = null;
    if (input.update !== null) {
      const previous = state ?? initialState;
      if (previous === null) return null;
      Y.applyUpdate(doc, decodeBase64(input.update, projectDocumentCollaborationMaxBytes));
      const merged = Buffer.from(Y.encodeStateAsUpdate(doc));
      if (merged.byteLength > projectDocumentCollaborationMaxBytes) return null;
      if (!merged.equals(previous)) {
        const html = serializeDocument(doc);
        // The projection must check the same structure delivered to collaborators.
        if (!merged.equals(Y.encodeStateAsUpdate(doc))) return null;
        change = { state: merged, bodyHtml: html };
      }
    }
    const vector =
      input.stateVector === null
        ? undefined
        : decodeBase64(input.stateVector, projectDocumentStateVectorMaxBytes);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64");
    return { initialState, change, update };
  } catch {
    return null;
  } finally {
    doc.destroy();
  }
}
