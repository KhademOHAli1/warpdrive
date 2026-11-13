# Public documentation hosting

Warpdrive uses [Fumadocs](https://fumadocs.dev/) and Next.js static export for its public
documentation. The source collection is `docs-site/docs/`. Add a Markdown page there and
order it in the relevant `meta.json`. Use MDX for components such as `Callout`. Keep operator
runbooks, historical evidence and internal assets outside the public collection.

## Build and verify

Run from `docs-site/` with the Bun version in its `package.json`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run check:export
```

The build writes the static site to `docs-site/out/`. Serve that directory at the root
of a preview host. The full CI workflow also uploads it as `warpdrive-docs-preview-<commit>`.
The search page and search dialog use the generated index in the same export.

Host the export on its own static site project. The docs use a separate build and have
no service, ingress route, database, or credentials in the CRM Compose stack.

Keep `/` as the introduction, preserve the existing guide URLs and heading IDs, and use
root-relative links in public guides. The export check records the existing bookmarks
and sidebar order. It also checks local links and assets, including screenshot paths.
Place images intended for publication under `docs-site/public/img/`.

## Promote the static export

On 13 November 2026, the live site linked to the upstream Warpdrive repository. It served
28 of the fork's 30 guides. The workflow and regional settings pages are present in the
fork export, which also preserves five older live bookmarks. Confirm the existing hosting
project and the authorized domain owner before changing the live association.

1. Build and check the reviewed commit. Preview the same export on the target host.
2. For a [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/),
   connect the fork and set the root directory to `docs-site`, the build command to
   `bun install --frozen-lockfile && bun run build && bun run check:export`, and the
   output directory to `out`. Use the package-pinned Bun version. An approved
   direct-upload project can instead receive the verified `out/` directory.
3. Check the introduction, a nested guide, screenshots, search and a legacy fragment on
   the preview. Retain the last known good deployment and domain configuration.
4. Use the [Pages custom-domain settings](https://developers.cloudflare.com/pages/configuration/custom-domains/)
   to attach `docs.warpdrivecrm.com` to the verified project. Verify TLS, redirects
   to trailing-slash routes, search, and the sitemap and discovery files on the
   live hostname. If those checks fail, restore the previous deployment or association.

## Retire the old docs after cutover

Record the current host project, its production deployment, the `docs.warpdrivecrm.com`
association, and any other hostnames the project serves before changing routing.
Keep the previous deployment available while the replacement is verified.

After cutover, check that the public hostname serves Fumadocs, including
`/features/automations/`, `/features/regional-settings/`, `/search/?q=mailbox`,
and a saved heading link. Confirm the canonical URLs, TLS and sitemap from the
public hostname. Retain the previous deployment identifier and the rollback procedure.

Once those checks pass and the operator no longer needs the old deployment for rollback,
disable the old docs project's automatic builds and deployment hooks. If a user-controlled
project serves only the legacy docs, retire its public preview and `pages.dev` URLs
as well. For a shared or upstream project, retire the Warpdrive docs association and
ask its owner to handle any remaining endpoints. Keep the marketing and CRM hostname
associations outside this change. Record which endpoints were retired and verify that
they no longer serve the old docs.

Cloudflare provides [branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
and [production rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/)
within a project. A move between projects requires a separate rollback of the hostname
association and its DNS record.

## Proposed repository split

| Repository     | Owns                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warpdrive      | CRM, public guides under `docs-site/docs/`, and their assets under `docs-site/public/img/`. Operator guides and evidence stay in the repository documentation. |
| Docs renderer  | Fumadocs, its dependency lock, theme, search, export checks, and deployment to `docs.warpdrivecrm.com`.                                                        |
| Marketing site | The current `site/` package, its dependency lock, and deployment to `warpdrivecrm.com`.                                                                        |

The docs renderer should build from a reviewed Warpdrive commit. Its CI can receive an
archive of just `docs-site/docs/` and `docs-site/public/img/` from that commit. Record the
content commit, renderer commit, and export digest together so either site can roll back
independently. Keep edit links pointing at the source guides in Warpdrive.

Qualify the new repos and their previews before moving either hostname. Warpdrive currently
requires the marketing and docs checks on `main`. Keep equivalent checks while their CI and
the GitHub ruleset are updated. CRM Docker inputs and Tailwind scanning still include the
website folders. Coordinate their removal with the Web release owner, including the
input policy and retained-image checks, as part of the repo split.
