# Dashboard navigation

The sidebar starts with Dashboard, Activities, Leads, Inbox and Contacts. Settings,
Workflows and Help & docs form the smaller utility group. Number-key shortcuts
follow the same visible order.

Dashboard is the shared entry point for the existing pipeline workspaces and
Performance. Its selector is used on pipeline boards, lists, archived-deal views
and Performance. Performance's pipeline filter still controls which records its
charts aggregate; that filter is separate from dashboard navigation.

## Current implementation

- Existing pipeline and Performance URLs remain valid. Dashboard is active for
  both route families.
- Pipeline choices come from the existing server-authorized visible-pipeline
  list. The selector does not enumerate raw settings records or grant access.
- Performance retains its existing personal/team statistics permissions.
- Switching pipelines keeps the current board, list or archived-deal layout.
  Entering a pipeline from Performance opens its board.
- An account without visible pipelines can still select Performance. Existing
  authorized first-pipeline creation remains available.
- No new membership store, dashboard builder or role policy is introduced.

## Product direction

The central selector will later select the dashboards available to the signed-in
user through their memberships and role. Requested future dashboard types include
different pipeline formats, workflow views and product-management charts. Dashboard
creation and configuration will be added in a later increment.

Keep dashboard identity and authorization separate from its presentation layout.
Future types should join this selector through an authorized source and a typed
destination, rather than adding another primary sidebar destination. Do not expose
creation actions or view types before their underlying behavior and permission
checks exist. Role-based default selection and dashboard membership need their own
server-side design and qualification.
