# Settings redesign

The settings-only follow-up to the workspace redesign uses the supplied flat
prototype: secondary navigation beside page content, compact provider rows,
and one inline editor. Inputs, meaningful row separators, and independent
dialogs retain their borders; decorative nested panels are removed.

## Existing behavior retained

| Section | Implementation and data source |
| --- | --- |
| Preferences | Existing browser-local workspace labels, light/dark/system appearance, and locale |
| Email | Existing connection, scan settings, scan and disconnect APIs; review stays in Activity |
| AI models | All six supported providers; existing credential and model-discovery APIs |
| MCP connections | Existing connector CRUD and tool discovery; visible Nexus endpoint and expandable client instructions |
| API access | Existing personal-token generation, one-time display, copy, and revocation |
| Users / Audit log | Existing admin-only components and server authorization |
| Assistant behavior | Existing server-enforced approval and permission policy; no new policy selector |

## Provider editor

- Connect/Manage opens one editor and focuses its first relevant control.
- Discovery is a read-only provider request. It never saves credentials or
  claims that a listed model has been successfully used for inference.
- Saving is explicit. Existing keys need not be supplied again; saved secrets
  are never returned to the form. Entered keys live only in editor memory.
- Manual model IDs remain available. After failed discovery, manual setup can
  be saved with an explicit warning that the credential/model is unverified.
- Errors retain the draft. Changing keys or closing an editor invalidates
  outstanding discovery responses. Save closes the editor and refreshes its row.
- Cancel/Escape discards the draft and restores focus. Dirty navigation asks
  before leaving; the assistant receives only a dirty-editor marker, not inputs.

The persistent `HistoryNavigationGuard` registers before Next's router listener
and gives settings a cancelable history event. Keep it at the app boundary:
registering only inside Settings is too late after client-side navigation, and
the router can unmount the dirty editor before its listener gets called.

## Verification and deployment

Behavioral tests cover discovery versus persistence, stale results, optional
credential replacement, manual fallback, save failure, editor focus, navigation
guards, browser-local save failure, and email/token errors. Browser checks use
intercepted synthetic writes and inspect all eight sections at 320, 768, and
1440 CSS pixels in both themes, including layout with Assist open.

No dependency, schema, migration, or environment changes are required. Live
provider credentials, Gmail connections, and outbound messages are not exercised
by the synthetic browser checks.
