# Session recovery

SunlightIDE automatically checkpoints open editable tabs, unsaved text, untitled
drafts, tab order, active tab, language mode, indentation, selections and scroll
positions, plus split-editor groups and divider width. Changes are checkpointed after 400 ms of inactivity and at least every
two seconds while editing continues. A final checkpoint is made when the window
unloads. A sudden crash can lose edits made since the last completed checkpoint.

On the next launch, unsaved edits return as dirty tabs with a recovery notice.
They are not written to your source files until you save. Clean tabs read their
latest content from disk. If a source file changed since the checkpoint, recovery
keeps your draft and reports the conflict so you can review before saving. If a
file was deleted, its draft can still be recovered and saved again.

Choosing **Don't Save** when closing a tab or window discards the corresponding
unsaved edits from recovery, including the fallback checkpoint. Choosing **Cancel**
keeps editing. The existing save prompts remain in place.

Recovery files live in the app's local user-data directory as `session.json` and
`session.previous.json`. Checkpoints are written to a temporary file, flushed and
renamed into place; a previous valid checkpoint is available if the latest one is
corrupt. Recovery never includes read-only diffs, logs or extension detail pages.
Undo history and terminal processes are not restored. The checkpoint limit is
128 MB and 1,000 editable tabs; a visible error reports checkpoint failures.

Run `npm run test:recovery` to test a real main-process crash and restart against
a temporary profile. It also checks externally changed and deleted source files.
