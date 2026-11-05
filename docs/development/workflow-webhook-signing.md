# Signed workflow webhook

The operator provisions a 32 byte random base64url signing key, without padding, in `WORKFLOW_WEBHOOK_KEYS_FILE` or `WORKFLOW_WEBHOOK_KEYS`. The JSON array accepts up to 100 exact `{workflowId, ownerId, signingKey}` entries. Replace the affected processes when changing the operator key or owner. The editor displays the active publication's endpoint after publishing. Keys are never exposed by the editor or endpoint.

Send to `/api/workflows/<workflow-id>/webhook/<version-id>` with `X-Warpdrive-Webhook-Timestamp` (Unix seconds) and `X-Warpdrive-Webhook-Signature` (`v1=` followed by the lowercase HMAC-SHA256 hex). Use the decoded key bytes to sign the UTF-8 prefix below, then the exact payload bytes. Include a newline after the timestamp.

```text
warpdrive.workflow.webhook.v1
METHOD
workflow-id
version-id
unix-seconds
```

For POST, send `application/json` (optional UTF-8 charset) and a body of at most 1024 bytes with exactly `eventId` and `recordId` UUIDs. Append the body bytes to the prefix. For GET, send no body or content type and use exactly the canonical lowercase `eventId=<uuid>` query string. Append that string without the leading `?`. Only POST exposes an authorized Deal ID to downstream steps.

An accepted delivery returns an empty 202 response. Keep the event ID stable across retries. A retry can be re-signed with a current timestamp and the same publication and payload. A mismatched replay is refused, including across republication. The server checks the current owner, workflow access, and publication under lock. Paused and archived workflows are unavailable.
