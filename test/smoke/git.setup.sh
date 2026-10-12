#!/usr/bin/env bash
# Prepares a repository for the git smoke test: history plus every kind of change.
set -euo pipefail
cd "$1"
git init -q -b main
git add -A
git commit -qm "initial import"
# modified + added + deleted lines in app.js
python3 - <<'PY'
p = 'app.js'
lines = open(p).read().split('\n')
lines[0] = '// Sunlight demo: CHANGED first line'     # modified
del lines[3]                                         # deleted (STORAGE_KEY line region)
lines[10:10] = ['  // added one', '  // added two']  # added
open(p, 'w').write('\n'.join(lines))
PY
echo "/* tweak */" >> style.css && git add style.css   # staged
rm README.md                                          # deleted in working tree
echo "hello" > new.txt                                # untracked
echo "export const x = 2;" >> src/view.js             # modified inside a folder
printf 'ignored.log\n' > .gitignore && echo junk > ignored.log
