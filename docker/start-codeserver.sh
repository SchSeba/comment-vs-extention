#!/bin/sh
set -eu
umask 077

if [ ! -f "$CODEX_HOME/config.toml" ]; then
    printf '%s\n' 'cli_auth_credentials_store = "file"' > "$CODEX_HOME/config.toml"
fi

# The VSIX is optional in the base IDE stage. Register only once so container
# recreation preserves any subsequent edits to the user's Codex configuration.
if [ -f /opt/local-review-mcp.cjs ] && ! codex mcp get local-review >/dev/null 2>&1; then
    codex mcp add local-review -- node /opt/local-review-mcp.cjs
fi

for source in /opt/local-review-skills/*/SKILL.md; do
    [ -f "$source" ] || continue
    folder=${source%/*}
    skill="$CODEX_HOME/skills/${folder##*/}/SKILL.md"
    if [ ! -e "$skill" ]; then
        install -D -m 0600 "$source" "$skill"
    fi
done

exec code-server --bind-addr 0.0.0.0:10000 --auth none \
    --config "$HOME/.local/share/code-server/config.yaml" \
    --extensions-dir "$CODE_SERVER_EXTENSIONS_DIR" --disable-telemetry "$@"
