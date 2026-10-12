# Split editors

Use **View: Split Editor** in the command palette, the split button beside
the tabs, or **Cmd+\** on macOS (**Ctrl+\** elsewhere). Splitting opens a second view
of the current file. If both panes are already open, it opens the file in the other
pane. Both views share the same edits and save state, with independent
selections, scroll positions, tab lists, search and language intelligence.

Click a pane before opening a file to choose its destination. **Cmd/Ctrl+1** focuses
the left pane and **Cmd/Ctrl+2** focuses the right pane. Tab navigation and save,
undo, find, definition and extension commands use the focused pane.

Move tabs by dragging between tab strips, using the tab context menu, or choosing
**View: Move Editor to Other Pane**. Dragging within a tab strip reorders its tabs.
Closing one view of a shared file keeps the other view and its unsaved edits. Closing
the last view uses the normal save/discard prompt.

Drag the divider to resize. When the divider has keyboard focus, Left/Right adjust
its position and Home resets it; double-click also restores equal widths. Choose
**View: Join Editors** or the right pane's close button to merge tabs into one group,
keeping open documents and the focused view.

Session recovery restores both groups, their tab order, active tabs, per-group views
and divider position. Read-only page tabs such as extension details move between
groups rather than displaying the same DOM page twice. This version supports two
side-by-side groups; nested and horizontal splits are not included.
