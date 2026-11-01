# UX-04: saved-view reference evidence from Mobbin

Observed 1 November 2026; observation time recorded at 12:03 UTC. This is the date of this research, not the capture date or release version of either referenced interface. The returned metadata supplies neither capture dates nor app versions.

The approved question is: “What belongs in a personal or shared saved view?” Its requested comparison covers board/table/filter persistence, unsaved changes, columns, sort, ownership and sharing, with versioned-view UX, reset/duplicate behavior and return navigation as outcomes. Source: `docs/sales-platform/approved/UX-RESEARCH.md`, UX-04. This note adds a bounded reference inspection for SP-03 and SP-01.3; it does not complete UX-04, SP-01.3, participant research, language review or acceptance.

## Search and inspection record

Only these two read-only connector searches ran, each limited to two results and platform `web`:

| Call | Tool and actual query | Returned material | Images actually inspected |
| --- | --- | --- | --- |
| 1 | `search_flows`: `Attio creating a saved view` | Attio “Adding to favorites” and “Creating a view”; each lists four screens. Page 1 reports more results, which were not fetched. | Inline previews at positions 1, 3 and 4 of each flow. Position 2 of each flow was listed in metadata but was not shown or inspected. |
| 2 | `search_screens`, standard: `Attio company view advanced filters` | Two Attio Companies table screens. | Both returned inline screen images were inspected. Neither shows an open filter editor. |

Every call used the same task intent: `Improve CRM saved-view controls and recovery while preserving the existing application shell.` Every call used `output_destination: code`, omitted `output_tool`, and requested JPG previews. No AI usage notice was returned. No Mobbin content was saved, commented on or placed in a collection.

The images entered the reviewer context as inline image blocks. No preview/high-resolution image was downloaded, stored in the repository, repackaged or redistributed. The companion JSON retains identifiers and canonical links only.

## Visible flow evidence

| Exact source | Inspected frame and screen ID | What the image shows | Limit on inference |
| --- | --- | --- | --- |
| [Attio: Adding to favorites](https://mobbin.com/flows/62a40034-d85a-4d63-9164-0db6725132c4), flow `62a40034-d85a-4d63-9164-0db6725132c4` | 1/4; `df2bcdc2-5f03-430f-ae92-013056040463` | A Companies table remains visible behind the open “All Companies” view picker. The picker has a search field, named views and “Create new view.” A Favorites section is separate in the left navigation. | This is a visible picker, not proof of favorite mutation, sharing or keyboard behavior. |
| [Same favorites flow](https://mobbin.com/flows/62a40034-d85a-4d63-9164-0db6725132c4) | 3/4; `bbd875eb-f4c3-4600-bbd6-44da33761528` | A view labeled “UK, French and German Co...” is selected in the picker. A similarly labeled entry is present in Favorites. The underlying table shows three rows and a three-count footer. | The omitted frame 2 may contain the actual favorite action. These previews do not show that action, its reversal or persistence after reload. |
| [Same favorites flow](https://mobbin.com/flows/62a40034-d85a-4d63-9164-0db6725132c4) | 4/4; `66dc9e4e-f6c3-43d3-8544-0de050695516` | The picker is closed. The selected view name, “Sorted by Last interaction” and “Advanced filter 3” remain visible above the three-row table. The favorite entry remains in the sidebar. | Visible continuity only; no return-from-record, account change, native reload or server-persistence operation was observed. |
| [Attio: Creating a view](https://mobbin.com/flows/26cf9d81-99c8-466c-8a4a-c257690f4551), flow `26cf9d81-99c8-466c-8a4a-c257690f4551` | 1/4; `df2bcdc2-5f03-430f-ae92-013056040463` | The same Companies picker provides “Create new view” alongside existing named views and keeps the table context behind it. | This screen ID is shared with the first flow. It is one distinct source screen displayed twice, not independent corroboration. |
| [Same create flow](https://mobbin.com/flows/26cf9d81-99c8-466c-8a4a-c257690f4551) | 3/4; `5b6d7dac-d494-470e-b163-c80d632ce234` | A compact “Create view” dialog asks for a Title, showing “Non-US Companies.” It has Cancel/ESC and Create view actions. The prior table is still visible behind it. | No saving, validation, error, owner/share controls or copy-layout explanation is visible. Position 2 was not inspected. |
| [Same create flow](https://mobbin.com/flows/26cf9d81-99c8-466c-8a4a-c257690f4551) | 4/4; `1519b1e9-e389-473d-b65a-03be39070551` | “Non-US Companies” is now the selected view. The company-name column has rows and a footer count of 13. An “Add your first attribute column” message and Add Attribute Column action occupy the remaining table area; Sort and Filter controls are visible. | A title alone does not establish inherited filters, columns or sort. This result is not an empty-record state: rows are visible. Do not infer a cloning contract or a filter defect from the previews. |

## Visible standalone screens

| Exact source | Screen ID | Visible observation | Relevance and limit |
| --- | --- | --- | --- |
| [Attio: Companies with selected view and applied scope](https://mobbin.com/screens/f85654c3-a89c-444e-bdf4-7ba40c3118f4) | `f85654c3-a89c-444e-bdf4-7ba40c3118f4` | Selected “UK, French and Ge...” view, three visible rows, “Sorted by Last interaction,” “Advanced filter 3,” View settings and Import/Export. | Scope remains legible beside the selected view. The filter conditions and editor are not visible; number 3 must not be interpreted as an inspected filter AST. |
| [Attio: Companies table with default controls](https://mobbin.com/screens/e1fcdf36-7726-4a8a-9ca7-7188daa3be36) | `e1fcdf36-7726-4a8a-9ca7-7188daa3be36` | “All Companies,” Sort and Filter controls, a populated attribute table and “No favorites” in the sidebar. A “Collapse sidebar” tooltip is visible. | This supplies a default-versus-selected-control comparison. It supplies no open advanced-filter interaction, empty-record recovery, sharing or effective-access evidence. |

Eight inline previews were displayed and inspected across both calls, representing seven distinct screen IDs because the initial picker screen occurs in both flows. No other frames were inspected. Descriptions above are limited to these images rather than the complete metadata-listed sequences.

## Decisions for Warpdrive

The existing shell audit already covers M-01 workspace switching, M-03 list-template selection and M-04 sharing a list. Those observations remain historical, source-bound references in `current-shell-research.md`; this study did not re-fetch or re-inspect those flows. They do not establish saved-view persistence or access semantics.

| Decision | Evidence and intended application | Warpdrive boundary |
| --- | --- | --- |
| Adopt the information order | The selected name, sort indicator and applied-filter summary are visible together in the final favorites preview and standalone selected-view screen. Keep the selected view near existing scope controls so sellers can explain the current rows. | Retain Warpdrive's existing SidebarChrome, TopBar, Board/List/Archive toolbar, density, tokens and shared SavedViewControl. Add no parallel sidebar, record navigation or theme. |
| Adapt the searchable view picker | The initial picker combines search, existing named views and an explicit creation entry without abandoning the current table. Keep the same compact task sequence using the existing shared menu/dialog primitives. | Existing own/shared-view visibility is authoritative. Search must not disclose inaccessible view names or allow an unavailable selection to fall back silently to all records. |
| Adapt create to explicit saved content | The create dialog is short, but the inspected frames do not explain which filters, columns or sort are copied. Warpdrive needs a concise summary of what its actual V1 envelope captures before a layout-only or filtered save. | Current checked People/Organizations/Leads envelopes allow only their builtin column/sort registries. Unsupported scope disables save; a search draft/debounce or unsupported Leads quick-filter scope cannot be silently dropped. Do not advertise full Deals presentation or custom-field presentation as implemented. |
| Adapt favorites as navigation only | The final favorites frame preserves a named sidebar shortcut and the selected table context. A shortcut may improve return navigation without implying a new kind of record. | A favorite stores navigation intent, not a copied authority or dataset. Current actor ID-only selection preferences must still resolve through current visible views and existing record queries. |
| Reject copying an unexplained new-view default | The create result visibly contains records but no attribute columns beyond identity. Copying that visual default could erase useful personal context or imply an unproven cloning behavior. | Preserve Warpdrive's personal layout baseline. Explicit Clear restores it; named-view edits must not overwrite it accidentally. Any later duplicate/reset operation must state which definition and presentation are copied. |
| Reject authority inference from UI appearance | None of these inspected images shows sharing roles, denial, revocation or executing-viewer access. A view name, favorite, record count or selected filter chip proves no capability. | Sharing a definition grants no record or field access. Unavailable/private/malformed selections stay blocked without leaking names or raw unsupported values. Retain actor-switch fences, strict write admission and explicit recovery. |
| Retain separate schema/version recovery | No inspected frame shows migration, unsupported versions, conflicting edits or uncertain save outcomes. These states need original Warpdrive designs and direct qualification. | Never convert invalid stored JSONB into an empty executable filter or overwrite a stored unsupported definition while offering recovery. No new autosave or blind retry behavior is justified by this reference. |

Current implemented boundaries are documented in `docs/sales-platform/saved-view-presentation-contract.md` for checked tree 03100336 / locally adopted application 7c107616. The unadopted Deals server-sort candidate and regional/auth source candidates do not gain qualification from this UX reference.

## Original state-copy hypothesis

Proposed copy for a named view whose local presentation has changed, with an explicit recovery action. This is original draft language, not a translation of Mobbin and not a native-language sign-off:

| Language | Proposed status | Proposed action |
| --- | --- | --- |
| Farsi | تغییرات این نما ذخیره نشده‌اند. | بازگشت به نمای ذخیره‌شده |
| German | Die Änderungen an dieser Ansicht sind noch nicht gespeichert. | Gespeicherte Ansicht wiederherstellen |
| English | Changes to this view have not been saved. | Restore saved view |

The action must describe an available operation precisely: returning to a named saved presentation is different from Clear restoring the actor's personal baseline. Until explicit reset/version behavior exists, do not add an action that silently overwrites either baseline. Draft text should survive a denied, stale or unconfirmed write; success requires the actual authorized persisted response.

## Missing evidence and next acceptance work

The bounded search did not reveal an open filter editor. Neither search supplies observed unsaved/saving/saved/error/offline/stale/conflict states; reset/duplicate/rename; shared-versus-personal ownership; effective access; rejected writes; inaccessible selected views; return from a record; responsive/RTL or language-switch behavior; or keyboard/screen-reader interaction. The previews are not a usability test, accessibility check or record-authority test.

UX-04 remains open. Any future design must be tested directly in Warpdrive against persisted envelope versions, current actor/record scope, exact reset/duplicate semantics and correct return navigation, first in Farsi and then German with English retained. This note neither implements those interactions nor replaces the approved research, runtime, security and recovery gates.


Exact connector identifiers, queries and inspected positions are in the [metadata record](ux-04-saved-view-reference-metadata-2026-11-01.json).
