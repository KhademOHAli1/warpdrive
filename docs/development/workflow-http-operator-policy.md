# Workflow HTTP endpoint grants

HTTP Request is a live workflow action. It appears in the picker with a setup requirement until a workspace administrator opens a workflow with an approved endpoint. Draft and published simulations never dispatch a request.

The deployment operator supplies a bounded JSON array via `WORKFLOW_HTTP_GRANTS_FILE` (preferred for any credential) or `WORKFLOW_HTTP_GRANTS`. An empty or malformed policy grants no access. An endpoint entry has:

- `workflowId`: the exact workflow UUID.
- `url`: the exact canonical HTTPS URL, including path and query string. Do not place credentials in the URL.
- `methods`: one or more of `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
- `authoredHeaders`: optional application header names the workflow may supply.
- `operatorHeaders`: optional operator-supplied headers such as `Authorization`. These values are never sent to the editor, stored in a run receipt, or included in the request digest.

Apply policy to the app and worker together. Replace the affected processes to load policy changes. Authored configuration and current workflow authority are checked again after the durable claim commits, just before a single pinned HTTPS attempt. Private addresses, mixed DNS answers, redirects, transport framing headers, and method/route override headers are refused. Only declared scalar response fields and the status code enter the run output.

An interrupted authorized request with no reliable response is recorded as unknown. The workflow worker will not retry that network call. Review the provider outcome before launching a new run.
