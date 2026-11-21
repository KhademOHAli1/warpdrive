"use client";

import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Doc } from "yjs";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { projectDocumentPeerColor } from "../live/awareness";
import { projectDocumentCollaborationFragment } from "../live/contracts";
import { projectDocumentExtensions } from "../live/editor";
import type { PageLabels } from "./pageLabels";
import {
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
  toggleUnderline,
} from "./planePageEditorCommands";

const tools = [
  { key: "bold", format: "bold", icon: Bold, run: toggleBold },
  { key: "italic", format: "italic", icon: Italic, run: toggleItalic },
  { key: "underline", format: "underline", icon: Underline, run: toggleUnderline },
  {
    key: "heading",
    format: "heading",
    icon: Heading2,
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  { key: "bullets", format: "bulletList", icon: List, run: toggleBulletList },
  { key: "numbers", format: "orderedList", icon: ListOrdered, run: toggleOrderedList },
  { key: "quote", format: "blockquote", icon: Quote, run: toggleBlockquote },
  {
    key: "code",
    format: "codeBlock",
    icon: Code,
    run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
] as const;

export function ProjectPageEditor({
  html,
  editable,
  labels,
  shared,
  awareness,
}: {
  html: string;
  editable: boolean;
  labels: PageLabels;
  shared: Doc | null;
  awareness: Awareness | null;
}) {
  const extensions = useMemo(() => {
    if (shared === null) return projectDocumentExtensions(false);
    const collaboration = [
      ...projectDocumentExtensions(true),
      Collaboration.configure({ document: shared, field: projectDocumentCollaborationFragment }),
    ];
    return awareness === null
      ? collaboration
      : [
          ...collaboration,
          CollaborationCaret.configure({
            provider: { awareness },
            user: { color: projectDocumentPeerColor(awareness.clientID), name: "" },
          }),
        ];
  }, [awareness, shared]);
  const editor = useEditor({
    immediatelyRender: false,
    ...(shared === null ? { content: html } : {}),
    extensions,
    editable,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": labels.body,
        "aria-multiline": "true",
        class:
          "min-h-64 wrap-anywhere px-5 py-4 leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_code]:rounded [&_code]:bg-muted [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:min-h-lh [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6",
      },
    },
  });
  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: tools.map(({ format }) => current?.isActive(format) ?? false),
      undo: current?.can().undo() ?? false,
      redo: current?.can().redo() ?? false,
    }),
  });
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  return (
    <div className="rounded-lg border bg-card [&_.collaboration-carets__caret]:pointer-events-none [&_.collaboration-carets__caret]:relative [&_.collaboration-carets__caret]:-mx-px [&_.collaboration-carets__caret]:border-s-2 [&_.collaboration-carets__label]:absolute [&_.collaboration-carets__label]:-inset-s-0.5 [&_.collaboration-carets__label]:-top-5 [&_.collaboration-carets__label]:z-10 [&_.collaboration-carets__label]:whitespace-nowrap [&_.collaboration-carets__label]:rounded-sm [&_.collaboration-carets__label]:px-1 [&_.collaboration-carets__label]:text-xs [&_.collaboration-carets__label]:text-white">
      {editor !== null && editable && (
        <fieldset className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
          <legend className="sr-only">{labels.body}</legend>
          {tools.map(({ key, icon: Icon, run }, index) => (
            <Tip key={key} label={labels[key]}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-8 p-0 aria-pressed:bg-accent"
                aria-label={labels[key]}
                aria-pressed={selection?.active[index] ?? false}
                onClick={() => run(editor)}
              >
                <Icon aria-hidden="true" className="size-4" />
              </Button>
            </Tip>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            aria-label={labels.undo}
            title={labels.undo}
            disabled={selection?.undo !== true}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            aria-label={labels.redo}
            title={labels.redo}
            disabled={selection?.redo !== true}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 aria-hidden="true" className="size-4" />
          </Button>
        </fieldset>
      )}
      {editor === null ? (
        <div aria-hidden="true" className="min-h-64" />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
