---
sidebar_position: 4
title: Company settings
description: "Configure Warpdrive for your team: labels, lost reasons, activity types, and pipelines."
---

# Company settings

Open **Settings > Workspace details** (`/settings/company`) for company identity,
branding, legal details, and work profile. Open **Sales & workflow** in Settings
for the shared catalogs described below.

## Labels

`/settings/company/labels` manages the coloured labels applied to deals, people, and
organizations.

![Label settings](/img/screenshots/company-settings/labels.png)

Labels are shared across the deployment rather than per user, so they work as a common
vocabulary. A default set is seeded on first run.

## Lost reasons

`/settings/company/lost-reasons` manages the reasons offered when a deal is marked
lost.

Use distinct reasons that your team can apply consistently. Those reasons appear
in the [Performance](../features/dashboard.md) breakdown for lost deals.

:::note
Marking a deal lost by **dragging it onto the Lost drop zone on the board** does not
prompt for a reason. To record one, close the deal from the deal page instead.
:::

## Activity types

`/settings/company/activities` manages the activity types available when scheduling,
such as call, meeting, and task.

## Pipelines

`/settings/company/pipelines` lists pipelines. Stages are edited from the pipeline
itself, at `/pipeline/[id]/edit`. See [Pipeline](../features/pipeline.md).

A pipeline can be restricted to a visibility group. Non-administrators outside
that group cannot see the pipeline or its deals, even ones they own. See
[Visibility groups](./visibility-groups.md).

## Who can change these

Administrators, and holders of the relevant management permission. See
[Permission sets](./permission-sets.md).

## Related

- [Data fields](./data-fields.md)
- [Pipeline](../features/pipeline.md)
