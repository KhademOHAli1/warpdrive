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
