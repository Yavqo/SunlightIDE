# SunlightIDE Interaction Contract

This records the existing Electron workflow and the new editor-group behavior.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Editor Groups | EditorGroups and pane factory | src/renderer/editor/groups.js; src/renderer/app.js | single / side-by-side | test/groups.test.mjs; test/smoke/split.js |
| Navigation | Command palette and group tab renderer | src/renderer/app.js | keyboard / tab / context menu | test/smoke/split.js |
| Resize | makeSash | src/renderer/ui/util.js | pointer / keyboard / reset | test/smoke/split.js |
| Scrollbar | Shared application stylesheet | src/renderer/styles.css | tab strip / editor / popup | test/smoke/split.js |
| Toast | Shared toast helper | src/renderer/ui/util.js | status / error / actionable | test/smoke/updates.js |
| Dialog | Electron dialog API | src/main/main.js | file / folder / save confirmation | test/smoke/ext.js |
| Recovery | SessionStore and session snapshot | src/main/session.js; src/renderer/editor/session.js | single / split layout | scripts/test-recovery.js; test/smoke/split-recovery-read.js |

## Editor Groups

Opening a file targets the focused group. Splitting copies the view, sharing one
buffer and save state. Selections, scroll positions, search and tab order are independent.
Moving a tab transfers membership. Joining retains all tabs without duplicates.
Closing a shared view never discards its buffer; only closing the last view invokes
the normal dirty-file prompt. Read-only page tabs move between groups because their
DOM view is unique. Saving and extension commands target the focused editor.

## Feedback, focus and recovery

Reuse the existing native Electron dialogs for save/discard decisions, the command
palette for navigation and the shared toast helper for async failures. Never silently
write recovered edits to source files. Recovery saves group membership, per-group
view state, active group and divider ratio alongside the existing document snapshot.
