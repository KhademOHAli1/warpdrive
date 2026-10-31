# UX-013: provider asset provenance and qualification

Audit date: 2026-10-31. Final source checkpoint: `bc40519b4f8f7147f6232897c26450bb8c478816`.
The reviewed registry, SVGs, notices, mark component and selected tests were unchanged between
the initial `87809b81185752bbed68db3abf60a33f7d969c69` inspection and that checkpoint. Their paths
were clean. Evidence class: current local asset/source validation, primary license/revision
verification and explicitly historical appearance evidence. No artwork, production source,
license notice, tracker or other peer file was changed by this audit.

Exact UX-013 acceptance: “Keep approved local SVGs, source revisions, licenses, safe markup and
light/dark appearance without remote tracking loads.” Verification is asset validation; UX-001
is the recorded dependency in the active 446-task register. This record does not change status
or establish vendor approval, endorsement, trademark permission or a live provider connection.

## Registry and retained provenance

`src/features/integrations/catalog.ts:12` defines 21 stable entries. Twenty resolve to local
`/integrations/<id>.svg` paths; `other-mcp` has `asset: null` and uses the generic Lucide Plug
(`:38`, `src/features/integrations/IntegrationMark.tsx:22`). Five entries have local auth paths;
16 are planned. A recognizable logo does not change that availability or authorize an account.

The retained mapping is `third-party/integration-logos.md:3` through `:32`: 16 SVG Logos files
and four Simple Icons files, with added SVG titles documented as the local accessibility change.
The manifest states geometry/provider colors are preserved. This audit verifies current local
markup and fingerprints, not a new per-path comparison against downloaded upstream artwork.

| Source | Pinned revision and primary evidence | Retained local notice |
| --- | --- | --- |
| G: SVG Logos, `gilbarbara/logos` | [`d6960edc1b7309d392c76e40d3a320df7f9ff85c`](https://github.com/gilbarbara/logos/commit/d6960edc1b7309d392c76e40d3a320df7f9ff85c); pinned [LICENSE.txt](https://github.com/gilbarbara/logos/blob/d6960edc1b7309d392c76e40d3a320df7f9ff85c/LICENSE.txt) identifies CC0 1.0 Universal. Both pages were retrieved on the audit date. | `third-party/integration-logos-LICENSE.txt`; SHA-256 `36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673` |
| S: Simple Icons, `simple-icons/simple-icons` | [`90646e4bf7f3b89df6c37e65baf3e7bc759a517c`](https://github.com/simple-icons/simple-icons/commit/90646e4bf7f3b89df6c37e65baf3e7bc759a517c), the 16.36.0 version commit; pinned [LICENSE.md](https://github.com/simple-icons/simple-icons/blob/90646e4bf7f3b89df6c37e65baf3e7bc759a517c/LICENSE.md) identifies CC0 1.0 Universal. Both pages were retrieved on the audit date. | `third-party/simple-icons-LICENSE.txt`; SHA-256 `9046848b63a5c92bff14e4accca80bd987e0623b74adf9226ce5198d312b79d5` |

The pinned licenses explicitly leave trademark/patent rights unaffected. The collection's CC0
notice therefore is not brand-owner permission or endorsement. The local manifest already says
the marks identify providers without implying endorsement. No account-specific brand approval or
separate permission record was located in these asset records; none is inferred from a commit.

### Complete current inventory

Each non-null local filename is `public/integrations/<registry ID>.svg`. G/S refer to the exact
revisions above. Fingerprints describe the current retained bytes, not unmodified upstream bytes.

| Registry ID | Declared upstream file | Current local SHA-256 |
| --- | --- | --- |
| `chatgpt` | G `logos/openai-icon.svg` | `9c4a3baf62dc6950e9357302080d33120005e866fbc101ca3fe3cf7cb4ed54c4` |
| `claude` | G `logos/claude-icon.svg` | `9821277268934ad3e1565cc651adb849ffc51b6cd88b3dbdac7097652bef5677` |
| `other-mcp` | No provider SVG; `Plug` from installed `lucide-react` | Not applicable |
| `gmail` | G `logos/google-gmail-2020.svg` | `a8bd38968d23f1ad18d1fbb34bdb1a91ea91dd89f1f427c88e03c02bff3380ed` |
| `slack` | G `logos/slack-icon.svg` | `c179deaee2623c32e7a34d5fdc196d7a8ca0459280fa16c2bbc33927367f48b8` |
| `google-calendar` | G `logos/google-calendar-2020.svg` | `f4d4364d0ee97d342bed7e7e2cc4425593de9f35e265362619ac44c9ab9c3237` |
| `microsoft365` | G `logos/microsoft-icon.svg` | `0a70bb4ba26d5cf9bbd377a82c7a14c845cda823032547505f7f8baa9921740a` |
| `zoom` | G `logos/zoom-icon.svg` | `846c65a943c7a90e65445122b4a7c6fe5a567b8031b85aecb0cb4e13c537d45e` |
| `n8n` | G `logos/n8n-icon.svg` | `97752487f4aea58f4af6c2281483f6f112c1d12b5033044fbd9d4858f800d747` |
| `make` | S `icons/make.svg` | `454b57e9280a5218d256ac35974408a6a955f089fd6a854c14bb08add3a088c4` |
| `zapier` | S `icons/zapier.svg` | `6831d26f31b07ffd71af6818113f0431992b60746c8da94a94d753054d9d6f85` |
| `google-drive` | G `logos/google-drive-2020.svg` | `f234cabc7630f87387823882b1747c9cb09bcf303ecc7e25eb1e0d9372935da9` |
| `onedrive` | G `logos/microsoft-onedrive.svg` | `4fab5113b4f6ef001af134416ccd54e42e1f3ca66fc9b0c85761643def7915e4` |
| `dropbox` | G `logos/dropbox.svg` | `32f5f7542af772ef29423a9e4db6f3a887c17e3a3c133f5f7f6a52caae2e734d` |
| `github` | G `logos/github-icon.svg` | `82d8ecbd889132e2bc9c65a20e5810ae67e0b550d323e2c1a939cf9cc3fda5cd` |
| `linear` | G `logos/linear-icon.svg` | `e89b9f86d436579fa4b03b5c9532998d66ca400c5f3bfb19c5f6f7a7a7f9deac` |
| `jira` | G `logos/jira.svg` | `c9eb1c2a1de65f3a58aad61bddb3c3f928eb16fca0d5a234b5dd85ad08e42d08` |
| `calendly` | S `icons/calendly.svg` | `70270b7654e9f2bcf1c38549585537f7b4156e2d12e60dd7f2abef587a61f9b1` |
| `cal-com` | S `icons/caldotcom.svg` | `048adeb8698e39434f72c542022e08f28ed9bd17710b182b96c2e3be3b9b1673` |
| `whatsapp` | G `logos/whatsapp-icon.svg` | `074e5ed6bffef226dce92efd9b16038f40a7529de60f7baaaa54c068e580cdd7` |
| `stripe` | G `logos/stripe.svg` | `4420613935e3a0d1b6049fac08fa8de7a3f6b1362f4da9564c6a217f95c34eb1` |

The generic glyph's installed package is `lucide-react@1.64.0`, declared ISC in its package
metadata and retained `node_modules/lucide-react/LICENSE`. `bun.lock:1661` pins the package and
integrity. This is a generic connection symbol, not an official MCP brand mark. The retained
product-label mapping also uses an OpenAI icon for ChatGPT, a Microsoft icon for Microsoft 365
and a WhatsApp icon for WhatsApp Business; this record does not assert brand-owner approval of
those product variants.

## Current safe markup and local rendering

All 20 existing SVG files were read and XML-parsed locally. Each has a viewBox and title. The
observed element set is `svg`, `title`, `g`, `path`, `polygon`, `defs`, `linearGradient`, `stop`.
Observed attributes are static geometry, paint, viewBox/dimensions, IDs, role and version.
There are no scripts, event-handler attributes, foreign objects, image/use elements, style
elements/attributes, external entities, external href/src references or external paint URLs.
Jira, WhatsApp and Zoom use internal fragment gradient references; all referenced IDs resolve.
The only HTTP strings are SVG/XLink namespace declarations, not external resource references.

`src/features/integrations/integrationAssets.unit.test.ts:5` checks all 20 catalog marks for SVG,
viewBox and title, and rejects script/foreignObject, onload and HTTP href patterns. It is a
regression check, not a general sanitizer: it does not reject every event attribute, protocol,
CSS resource reference or external entity form. The broader static inspection above qualifies
the current bytes only. Future asset replacement must repeat that inspection or extend the
existing guard; passing its present regex alone is not enough to accept arbitrary SVG input.

`IntegrationMark.tsx:14` hides the decorative mark from assistive technology and uses an empty
image alt. Visible provider names remain adjacent in `IntegrationCard.tsx:25` and
`IntegrationDetails.tsx:75`. For branded SVGs the component loads the registry's local path
through `next/image`, with object-contain sizing at 24px or 16px. It does not fetch a logo from
a vendor, CDN or tracking service. There is no remote asset URL in the current registry or
SVG payloads. This is source/static evidence plus the historical loading evidence below, not
a new browser network trace or a claim about unrelated application traffic.

## Light/dark handling and actual appearance evidence

The component deliberately preserves provider colors on a white plate in both themes:
`bg-white ring-black/8`, normal `size-11` plate or compact `size-7`, and a contained image.
It does not invert/recolor vendor artwork or select a separate dark SVG. Generic MCP uses
`bg-muted ring-border` and `text-muted-foreground` (`IntegrationMark.tsx:17`). That semantic
fallback is a later source change, not the white plate visible for MCP in the old screenshots.

Historical qualification head: `e321126f98a37a376e72ab0e4513e0c5b003f2b5`. Its portable evidence is:

`/Users/ali/Documents/Codex/2026-10-29/https-github-com-sneg55-warpdrive-git/outputs/integration-polish-20261031/`

- `evidence/browser-checks.md` records local SVG loading, FA RTL, EN/DE, 320/390/768/1440 layouts,
  light/dark inspection, focus/keyboard behavior and the limits of that synthetic local session.
- The existing `screenshots/connections-fa-desktop.png` and `connections-fa-dark.png` were
  reopened as local images during this audit. They show readable ChatGPT, Claude, Gmail and
  Slack marks on white plates and the then-current generic MCP glyph, with adjacent names.
  The planned section is collapsed; these images do not show all 20 branded marks.
- `README.md` identifies that exact historical head and final screenshots; `*-before.png` files
  are defect evidence, not approved final screens. `docs/integration-ui-polish.md:25` records
  the same scope and explicitly excludes formal screen-reader conformance and live grants.

`git diff --name-only` from that historical head to the final checkpoint reports no change in
`public/integrations/` or the three retained provenance/license files. Current mark source later
adopted the registry asset field and semantic MCP fallback in
`a01ca83d09ef40dfe2421f96e024c66dbee0c3e2` and
`90ad0f4f5a8960eeae452ef1abf51a65699f56ec`. Historical branded-plate observations remain useful
because the artwork and its plate sizing/color are unchanged; they are not a fresh exact-head
appearance qualification of every provider, compact state or fallback.

## Small current validation

This exact existing unit selection ran successfully with pinned Bun 1.4.4:

```sh
PATH=/tmp/warpdrive-bun144/bin:$PATH /tmp/warpdrive-bun144/bin/bun --bun vitest run --project unit src/features/integrations/integrationAssets.unit.test.ts src/features/integrations/IntegrationMark.test.tsx src/paletteTokens.test.ts
```

Result: exit 0, **3 files / 12 tests passed**, Vitest 5.0.5, reported duration 977ms.
The runner emitted its existing future-native-config-loader warning; it was not suppressed.
No browser, PostgreSQL, build, typecheck, dependency install, asset download/export or service
change was performed. Local historical images were viewed in place without copying them.

Coverage limits: the asset test visits all 20 SVGs; mark rendering exercises seven named marks
and a registry-selected asset override. The palette test finds hardcoded gray-family utilities
across TSX; it does not measure contrast, render every theme, inspect SVG paint or reject a
deliberate white identity plate. Twelve passing tests do not establish visual acceptance.

## Bounded acceptance and actionable gaps

| UX-013 concern | Evidence now available | Remaining boundary or next concrete check |
| --- | --- | --- |
| Local inventory and provenance | All 21 IDs accounted for; 20 local SVGs, exact source revisions/file mappings, current hashes and retained licenses. Primary revision/license pages verified. | The manifest is the per-asset origin record; no fresh upstream artwork comparison or brand-owner product-variant approval was obtained. Preserve the pinned revisions when replacing assets. |
| Safe markup and no remote tracking loads | Current bytes parsed and inspected; no external resource references. Local registry rendering and all 20 asset checks pass. Historical browser record confirms local loading. | Strengthen the existing guard for future asset updates rather than relying on its narrow regex. A fresh network trace, if later required, must be labelled as that separate browser evidence. |
| Light/dark appearance | Fixed white branded plates, semantic generic fallback and unchanged provider bytes; historical actual FA light/dark screenshots inspected. | No complete current visual matrix exists for all 20 branded SVGs, both sizes/themes, or the later generic fallback. Inspect those states in the owning future browser/QA slice before claiming that full matrix. |
| Approved retention | Historical UI review/commit record and this reviewable inventory support a project decision to retain the current artwork. | No explicit per-asset approver/signoff is recorded in the inspected manifest. The register owner must distinguish project review from vendor/trademark permission; this audit invents neither and does not request a new external approval. |

The current local provenance/static-validation portion is supported. Historical appearance is
bounded as above; full current appearance and any separate approval evidence remain unproven.
The execution-register owner can decide the task's bounded acceptance after independent review.
This author did not close UX-013 or any later provider, marketplace, accessibility or release gate.
