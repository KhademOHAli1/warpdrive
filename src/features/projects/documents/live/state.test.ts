// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { expect, test, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { updateProjectDocumentPeers } from "./awareness";
import { projectDocumentCollaborationFragment as field } from "./contracts";
import { projectDocumentExtensions } from "./editor";
import { projectDocumentCursorInput } from "./presenceInput";
import { mergeProjectDocument } from "./state";

function encode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function startEditor(update: string) {
  const shared = new Y.Doc();
  Y.applyUpdate(shared, Buffer.from(update, "base64"));
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...projectDocumentExtensions(true),
      Collaboration.configure({ document: shared, field }),
    ],
  });
  return { editor, shared };
}

test("TipTap collaborators merge disjoint rich edits and remote deletions, including replay", () => {
  const initial = mergeProjectDocument(null, "<p>center</p>", { stateVector: null, update: null });
  if (initial === null || initial.initialState === null) throw new Error("Could not seed page");
  const first = startEditor(initial.update);
  const second = startEditor(initial.update);
  try {
    expect(first.editor.commands.insertContentAt(1, "<strong>Left </strong>")).toBe(true);
    expect(second.editor.commands.insertContentAt(7, " right")).toBe(true);
    const base = Y.encodeStateVectorFromUpdate(initial.initialState);
    const edit = (shared: Y.Doc) => ({
      stateVector: encode(Y.encodeStateVector(shared)),
      update: encode(Y.encodeStateAsUpdate(shared, base)),
    });
    const firstMerge = mergeProjectDocument(initial.initialState, "", edit(first.shared))?.change;
    const secondEdit = edit(second.shared);
    const secondMerge =
      firstMerge && mergeProjectDocument(firstMerge.state, "", secondEdit)?.change;
    if (secondMerge == null) throw new Error("Changes did not merge");
    expect(secondMerge.bodyHtml).toBe("<p><strong>Left </strong>center right</p>");
    expect(mergeProjectDocument(secondMerge.state, "", secondEdit)?.change).toBeNull();

    const vector = Y.encodeStateVector(first.shared);
    const remote = mergeProjectDocument(secondMerge.state, "", {
      update: null,
      stateVector: encode(vector),
    });
    if (remote === null) throw new Error("Could not read remote changes");
    Y.applyUpdate(first.shared, Buffer.from(remote.update, "base64"));
    expect(first.editor.getText()).toBe("Left center right");

    const nextVector = Y.encodeStateVector(first.shared);
    first.editor.commands.deleteRange({ from: 1, to: 6 });
    const deletion = mergeProjectDocument(secondMerge.state, "", {
      update: encode(Y.encodeStateAsUpdate(first.shared, nextVector)),
      stateVector: encode(Y.encodeStateVector(first.shared)),
    })?.change;
    expect(deletion?.bodyHtml).toBe("<p>center right</p>");
  } finally {
    first.editor.destroy();
    second.editor.destroy();
    first.shared.destroy();
    second.shared.destroy();
  }
});

test("rejects binary changes outside the document fragment", () => {
  const initial = mergeProjectDocument(null, "", { stateVector: null, update: null });
  if (initial === null || initial.initialState === null) throw new Error("Could not seed page");
  const shared = new Y.Doc();
  try {
    Y.applyUpdate(shared, initial.initialState);
    shared.getMap("unregistered").set("field", "unregistered");
    expect(
      mergeProjectDocument(initial.initialState, "", {
        stateVector: encode(Y.encodeStateVector(shared)),
        update: encode(Y.encodeStateAsUpdate(shared)),
      }),
    ).toBeNull();
  } finally {
    shared.destroy();
  }
});

test("TipTap publishes relative selections and renders and removes remote carets", async () => {
  const initial = mergeProjectDocument(null, "<p>cursor</p>", { stateVector: null, update: null });
  if (initial === null || initial.initialState === null) throw new Error("Could not seed page");
  const seeded = Buffer.from(initial.update, "base64");
  function client(name: string) {
    const shared = new Y.Doc();
    Y.applyUpdate(shared, seeded);
    const awareness = new Awareness(shared);
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      extensions: [
        ...projectDocumentExtensions(true),
        Collaboration.configure({ document: shared, field }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name, color: "#1d4ed8" } }),
      ],
    });
    return {
      awareness,
      host,
      editor,
      close() {
        editor.destroy();
        shared.destroy();
        host.remove();
      },
    };
  }
  const first = client("First");
  const second = client("Second");
  try {
    first.editor.view.dom.focus();
    first.editor.commands.setTextSelection({ from: 1, to: 3 });
    const input: unknown = first.awareness.getLocalState()?.cursor;
    const cursor = projectDocumentCursorInput.parse(input);
    updateProjectDocumentPeers(second.awareness, [
      {
        clientId: first.awareness.clientID,
        name: "First",
        cursor,
      },
    ]);
    await vi.waitFor(() =>
      expect(second.host.querySelector(".collaboration-carets__label")?.textContent).toBe("First"),
    );
    updateProjectDocumentPeers(second.awareness, []);
    expect(second.awareness.getStates().has(first.awareness.clientID)).toBe(false);
    await vi.waitFor(() =>
      expect(second.host.querySelector(".collaboration-carets__label")).toBeNull(),
    );
  } finally {
    first.close();
    second.close();
  }
});
