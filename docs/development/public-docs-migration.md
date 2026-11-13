# Public documentation migration handoff

The [Fumadocs](https://github.com/fuma-nama/fumadocs) migration is separate from
documentation content maintenance. Use [Fumadocs MDX](https://www.fumadocs.dev/docs/mdx)
for content and consult the [static export guide](https://www.fumadocs.dev/docs/next/deploying/static)
for routing and search when choosing the deployment model. Fumadocs provides the
site framework and Markdown rendering. Warpdrive still owns the content, publishing,
dependency updates and route compatibility.

- Publish the 30 guides in `docs-site/docs/`. Keep repository references, operator
  runbooks, archived evidence, localization sets and screenshot capture instructions
  outside that collection. Copy only assets the public guides intentionally render.
  The workflow guide has three image references into `docs/images/workflows/` that need
  an explicit asset mapping.
- Preserve root routes such as `/`, `/setup/` and `/features/pipeline/`. Retain
  the introduction at `/` by mapping Docusaurus's `intro.md` and `slug: /`
  to a root index. Keep the titles and descriptions. Recreate the order and
  categories from `docs-site/sidebars.ts` with
  [Fumadocs page metadata](https://www.fumadocs.dev/docs/next/page-conventions).
  File order and `sidebar_position` alone do not reproduce that navigation. The
  docs site is English; German and Persian runbooks stay in the repository.
- Preserve existing heading IDs and fragment aliases. Verify relative `.md` links,
  root-relative `/img/` assets, tables, language-tagged fences and Docusaurus
  `:::` admonitions after conversion. Translate renderer-specific syntax during
  the migration and check the output, including search at `/search/`.
- Compare both the fork build and the live host before cutover. On 13 November 2026,
  `/features/automations/` and `/features/regional-settings/` existed in the fork
  but returned 404 on the live host. The live host had older fragments for the
  introduction, Google OAuth setup, first-admin login, Google identity binding,
  and storage migration. Carry forward the compatibility anchors, and validate
  their destinations instead of carrying forward the older instructions.
- Test the resulting site from its actual hosting path. Compare every route and
  heading fragment, follow links, load images, and exercise navigation and search.
  Check that the output contains only the intended public material before promotion.
