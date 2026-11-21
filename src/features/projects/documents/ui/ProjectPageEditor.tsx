"use client";

import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
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

const extensions = [
  StarterKit.configure({
    link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
  }),
];

export function ProjectPageEditor({
  html,
  editable,
  labels,
  onChange,
}: {
  html: string;
  editable: boolean;
  labels: PageLabels;
  onChange: (value: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    content: html,
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
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? "" : current.getHTML()),
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
    <div className="rounded-lg border bg-card">
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
