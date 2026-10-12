# Split editor verification

The editor-group change is covered by `test/groups.test.mjs`, the real-app workflow
in `test/smoke/split.js`, and a main-process crash/restart in
`test/smoke/split-recovery-read.js`. The existing complete smoke suite covers editing,
find, tabs, Git, extensions, language intelligence and update notifications.

The rendered split layout was inspected in the Electron window. Narrow-pane bounds,
keyboard and pointer resizing, pane focus, tab movement, shared-file editing and
independent language completion are exercised in the split workflow.

The strict static design audit is saved in `premium-audit.json`. Canonical ownership
resolves, but the audit reports literal buttons as actionless because it only
recognizes inline `onclick` handlers. This application binds those buttons with
`addEventListener`, `.onclick` assignments or delegated `data-act` handlers during
initialization. The corresponding runtime interactions pass in the app smoke tests.
The static audit has not been represented as a passing check.
