# Plane Community adoption in Warpdrive Projects

The local comparison uses Plane Community v1.5.0 at
`18caf808a3af3fcabeeba7d1e8473f1367bff2d4`. The workspace directory is
`/comparison/projects/`. Its member profile needs a user ID in
`/comparison/profile/<userId>/`. The document workspace is the project-scoped
Pages route. These are separate from Plane’s account settings and public Spaces.

| Area               | Reused source and Warpdrive behavior                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects directory | Adapted Plane card, search, ordering, and filter patterns use Core’s permission-filtered projects and authoritative creation dates. Creation and project links still use Warpdrive project IDs.                                                                                                                                                       |
| Work items         | Adapted Plane layout selection and navigation. List groups by status, and Board shares the same records. A deep link opens work-item properties. Creation and updates support description, priority, dates, status, and authorized assignment. The 0122 migration preserves old identities and revisions and leaves unknown creators null.            |
| Your work          | Adapted the Plane profile navigation and stat content. Summary, Assigned, Created, Subscribed, and Activity use the signed-in member’s readable internal projects. Status and priority links lead to filtered work, and item links open their project detail. Subscriptions track followed items. Activity records committed item creation and edits. |
| Pages              | Adapted Plane’s Project, Private, and Archived tabs, create-and-open flow, and editor commands. Core stores one project-scoped page with sanitized rich text, lock and archive state, and revision history. A private page and its revisions require current project access and authorship.                                                           |
| Compatibility      | Client projects keep their paths, existing data and access. Projects uses the native Web/Core command boundary and project-local roles. Existing Work Profile and CRM activity records remain separate.                                                                                                                                               |

This increment covers the core directory, work item, personal queue, and Pages
journeys above. Remaining Plane behavior includes custom workflows, Cycles,
Modules, Saved Views, additional work-item layouts, subscription notifications,
and live Pages collaboration.

The source files containing adopted code identify their original source and
retain its copyright notice. The comparison checkout and instance remain
available for checking behavior against the local Warpdrive demo.
