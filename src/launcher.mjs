// Resolve the executable itself before locating the bundled runtime. $0 may be a PATH symlink.
export const launcher=[
  '#!/bin/sh',
  'set -eu',
  'DENG_SCRIPT=$0',
  'DENG_LINK_COUNT=0',
  'while [ -L "$DENG_SCRIPT" ]; do',
  '  DENG_LINK_COUNT=$((DENG_LINK_COUNT + 1))',
  '  if [ "$DENG_LINK_COUNT" -gt 40 ]; then echo "Deng launcher: too many symbolic links" >&2; exit 1; fi',
  '  DENG_LINK_DIR=$(CDPATH= cd -P -- "$(dirname -- "$DENG_SCRIPT")" && pwd)',
  '  DENG_LINK=$(readlink "$DENG_SCRIPT")',
  '  case "$DENG_LINK" in',
  '    /*) DENG_SCRIPT=$DENG_LINK ;;',
  '    *) DENG_SCRIPT=$DENG_LINK_DIR/$DENG_LINK ;;',
  '  esac',
  'done',
  'DENG_ROOT=$(CDPATH= cd -P -- "$(dirname -- "$DENG_SCRIPT")/.." && pwd)',
  'exec "$DENG_ROOT/runtime/node" "$DENG_ROOT/app/bin/deng.mjs" "$@"',
].join('\n')+'\n';
