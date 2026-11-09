#!/bin/sh
set -eu

vsix=${1:-local-review.vsix}
unzip -tq "$vsix"
entries=$(unzip -Z1 "$vsix")

for file in \
    extension/extension.cjs \
    extension/mcp.cjs \
    extension/review-store.cjs \
    extension/review-context.cjs \
    extension/skills/handle-comments/SKILL.md \
    extension/skills/mark-resolved-review/SKILL.md \
    extension/skills/clean-review/SKILL.md \
    extension/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js
do
    if ! printf '%s\n' "$entries" | grep -Fxq "$file"; then
        printf 'Missing required VSIX entry %s\n' "$file" >&2
        exit 1
    fi
done

printf 'Verified %s\n' "$vsix"
