import StarterKit from "@tiptap/starter-kit";

export function isProjectDocumentLink(href: string) {
  return /^(?:https?:|mailto:|#|\/(?![\\/]))/i.test(href);
}

export function projectDocumentExtensions(collaborating: boolean) {
  return [
    StarterKit.configure({
      ...(collaborating ? { undoRedo: false } : {}),
      link: {
        openOnClick: false,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { target: null },
        isAllowedUri: (href, { defaultValidate }) =>
          defaultValidate(href) && isProjectDocumentLink(href),
      },
    }),
  ];
}
