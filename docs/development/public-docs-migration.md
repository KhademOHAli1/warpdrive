# Public documentation hosting

Warpdrive owns the public guides and navigation in `docs-site/docs/` and their images in
`docs-site/public/img/`. Add pages and change `meta.json` in Warpdrive. Use MDX for components
such as `Callout`. Keep operator runbooks, historical evidence and internal assets outside
the public collection.

The standalone [warpdrive-docs repository](https://github.com/KhademOHAli1/warpdrive-docs)
owns Fumadocs, the theme, search, dependency lock, and export checks. **Edit on GitHub**
links point back to the guides in Warpdrive. The marketing site remains in `site/` and
will be considered separately.

## Build and verify

Use a checkout of the [renderer](https://github.com/KhademOHAli1/warpdrive-docs) at the
revision recorded in `docs-site/renderer.lock`. Run from the renderer root with the Bun
version in its `package.json`:

```sh
bun --no-env-file scripts/stage-content.mjs /absolute/path/to/warpdrive
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run check:export
```

Staging reads the Warpdrive checkout's committed `HEAD`. Commit a local content candidate
on its work branch before previewing it. Only the public guides, their navigation metadata
and images are staged. The build writes `out/` in the renderer checkout. Serve that
directory at the root of a preview host. The search page and dialog use the index in
the same export.

The [public CI workflows](../public-ci.md) use the renderer lock and stage the content
from the Warpdrive revision under review. The full workflow retains the verified site
as `warpdrive-docs-preview-<commit>` and records both revisions. The renderer's own build
pins the reviewed Warpdrive content revision in `content-source.json`. Keep the renderer
commit, content commit and export digest together when promoting an artifact.

The docs export has its own static hosting target and uses no CRM Compose service,
ingress route, or database.

Keep `/` as the introduction, preserve the existing guide URLs and heading IDs, and use
root-relative links in public guides. The export check verifies bookmarks, sidebar
order, links, and assets. Put new screenshots under `docs-site/public/img/` in Warpdrive.

## Promote the static export

Independent hosting is pending. On 13 November 2026, the live site served the original
upstream Warpdrive project's documentation, including 28 of the fork's 30 guide routes.
The Fumadocs export includes the workflow and regional settings pages and preserves
five older live bookmarks. The upstream Cloudflare project belongs to the original
maintainer. Confirm the authorized domain owner and the current association before
planning the cutover.

1. Build and verify the reviewed renderer and content revisions. Retain the output and
   its provenance.
2. Preview the verified `out/` in a static hosting project owned by the current
   maintainers. For Pages, use a [Direct Upload project](https://developers.cloudflare.com/pages/get-started/direct-upload/)
   or a [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
   connected to the renderer repository.
3. Check the introduction, nested routes, screenshots, search, and legacy fragments on
   the preview. Confirm the rollback path and current domain configuration.
4. An authorized domain owner can attach `docs.warpdrivecrm.com` to the verified project
   through the [Pages custom-domain settings](https://developers.cloudflare.com/pages/configuration/custom-domains/).
   Verify TLS, trailing-slash redirects, search, sitemap, and discovery files on the live
   hostname. Restore the previous association if these checks fail.

## Verify the cutover and retain rollback

Record the current host project, its production deployment, the `docs.warpdrivecrm.com`
association, and any other hostnames the project serves before changing routing.
Keep the previous deployment available while the replacement is verified.

After cutover, check that the public hostname serves Fumadocs, including
`/features/automations/`, `/features/regional-settings/`, `/search/?q=mailbox`,
and a saved heading link. Confirm the canonical URLs, TLS and sitemap from the
public hostname. Retain the previous deployment identifier and the rollback procedure.

The cutover concerns the `docs.warpdrivecrm.com` association. The upstream maintainer
controls their own project, preview URLs, and `pages.dev` endpoints. Record the old
association and verified rollback procedure without changing the upstream project.

Cloudflare provides [production rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/)
within a project. A move between projects requires a separate rollback of the hostname
association and its DNS record.

## Retire the old docs after cutover

Once the live checks pass and the operator no longer needs the old deployment for
rollback, disable automatic builds and deployment hooks on a legacy docs project
controlled by the current maintainers. If that project serves only the legacy docs,
retire its public preview and `pages.dev` URLs as well. Cloudflare provides
[branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
for managing automatic deployments.

For a shared or upstream project, retire the Warpdrive docs association and ask its
owner to handle the remaining endpoints. Keep the marketing and CRM hostname
associations outside this change. Record the endpoints retired and verify that they
no longer serve the old docs.

## Repository ownership

| Repository | Owns |
| --- | --- |
| Warpdrive | CRM, public guides under `docs-site/docs/`, and their images under `docs-site/public/img/`. Operator guides and evidence stay in the repository documentation. |
| Docs renderer | Fumadocs, its dependency lock, theme, search, export checks, and the static artifact for `docs.warpdrivecrm.com`. Hosting cutover remains pending. |
| Marketing site | The current `site/` package and its dependency lock remain in Warpdrive. A separate repository and hosting migration will be considered independently. |

The renderer stages a reviewed Warpdrive commit and records the content commit,
renderer commit and export digest together. Keep edit links pointing to the source
guides in Warpdrive. Qualify each hosting preview before moving its hostname.

Warpdrive retains the marketing and docs CI contexts on `main`. Preserve equivalent
checks while changing CI or repository rules. Coordinate removal of website folders
from the CRM Docker inputs or Tailwind scanning with the Web release owner, including
the input policy and retained-image checks.
