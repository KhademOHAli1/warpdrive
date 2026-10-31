# Integration UI research

Reviewed in the authenticated Mobbin web library on 2026-10-31. No Mobbin images,
logos, or interface code are redistributed with the open-source application.

## References actually inspected

1. [Attio: connecting an integration](https://mobbin.com/flows/71af99f1-da65-40d7-9ded-20a2ebbcc6c0).
   The three-screen flow starts with a searchable directory, opens Slack as a focused
   provider page, and offers Add Workspace followed by connected-workspace management.
2. [Attio: connecting Google Calendar](https://mobbin.com/flows/d0abf281-6de9-4d4d-82b3-dacdea792ed5).
   The flow explains the benefit before choosing a provider and hands consent to the
   provider. Permissions are part of the connection journey.

## Applied direction

- Preserve Warpdrive's current navigation, pale settings surface, neutral borders,
  existing type scale, radius, spacing and green action tokens.
- Use a directory with compact provider identity, a short purpose, truthful availability,
  search/categories, and one clear detail action.
- Keep account management separate from discovery, with AI setup beside authorized grants.
- Open a focused dialog for provider capabilities, permissions and setup. Show prerequisites
  with an explanation. Planned integrations expose details, never a pretend connection.
- Use the existing Radix Dialog, Tabs, Select and ConfirmDialog adapters for keyboard,
  focus, portals and direction. Restore focus when provider details close.
- Personal Gmail accounts and workspace Slack installs retain distinct authorization
  boundaries while remaining discoverable in the same hub.
- Treat FA/DE/EN, long German text, RTL layout, URL isolation, and mobile containment as
  part of the interface contract. Use the selected calendar/timezone for displayed dates.

## Deferred design work

The marketplace tab explains its next-stage status. It has no false installation controls.
Full app-detail, permission-review, install/update/uninstall, publisher and developer screens
must be designed alongside their real extension runtime, following the programme backlog.
