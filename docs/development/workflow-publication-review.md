# Workflow publication review (#683 / WF026)

This increment adds an explicit review between the editor's Publish button and the existing publication command. Opening the dialog performs no save or publication. Cancel and Escape dismiss it without writing. The existing dialog-focus helper returns focus to the Publish opener when available, otherwise to the editor heading. The dialog scrolls within the viewport and uses the English, German and Farsi catalogs.

The review displays the workflow name and configured step names, categories and effect explanations. It does not project literal or mapped configuration payloads into those summaries. A manual run uses the access of the person starting it. Live execution follows the selected branch; a configured task step describes a possible effect, not a promise that a task will be created. Simulation continues to use the active published version, rolls back CRM changes and proceeds without waiting through delays. This review does not simulate an unpublished draft.

## Review consistency and local gates

`publicationReview.ts` serializes the exact name and definition, including layout, together with revision, dirty state, active/publication metadata, archive state, availability and edit/publish capabilities. This cut is local consistency state, not an authorization token. The complete authored definition remains in the mounted review's transient state even though summaries omit its payloads.

An observed change makes the review stale. The component latches that state even if later edits return from A to B to A. Confirm stays disabled until the user explicitly chooses Review updated workflow. Renewing the review captures current content; it does not validate the content or grant access.

Confirmation is also blocked by a pending editor operation, invalid content, lost access, archive state, missing publish capability, or dirty content without edit capability. Each configured node is assessed through the existing `executableNode` predicate. An unavailable handler profile is shown explicitly and blocks confirmation; its connection requirements are not presented as assessed. Supported local CRM profiles do not require a connected provider. These local gates do not establish fresh server authority, current CRM metadata or eventual execution access.

## Dispatch and qualification boundaries

A successful confirmation requests dialog closure before invoking the unchanged `author("publish")` / `editor.perform("publish")` path. Dirty content first uses the existing save action, then publishes the acknowledged revision. A rejected save prevents publication. A clean user with publish capability can publish without edit capability or a preceding save. Existing command serialization, server checks, revision handling and action-error/fresh-authentication feedback remain in place. Saving a draft alone never activates it.

The implementation leaves the editor action hook, server actions, schemas, dependencies and provider behavior unchanged. Version comparisons, complete WF026 acceptance and broader test-runner work remain separate. The focused test definitions and source review do not by themselves establish native browser, assistive-technology, human, integration, release or deployment acceptance. Qualification records must identify their actual source revision and evidence level; no test result is asserted by this contract.
