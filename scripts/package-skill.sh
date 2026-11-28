#!/bin/sh
# Builds dist/recliner-skill.zip: the self-contained /recliner skill package.
# Usage: scripts/package-skill.sh [version]     (version defaults to the git short sha)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/skill/recliner"
VERSION=${1:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)}
OUT="$ROOT/dist"
STAGE="$OUT/stage/recliner"

echo "== check"
[ -f "$SRC/SKILL.md" ] || { echo "SKILL.md missing"; exit 1; }
head -1 "$SRC/SKILL.md" | grep -q '^---$' || { echo "SKILL.md has no frontmatter"; exit 1; }
grep -q '^name: recliner$' "$SRC/SKILL.md" || { echo "SKILL.md frontmatter needs name: recliner"; exit 1; }
grep -q '^description: ' "$SRC/SKILL.md" || { echo "SKILL.md frontmatter needs a description"; exit 1; }
find "$SRC" -name '*.mjs' -print | while read -r f; do node --check "$f"; done
# Keys must never ship.
if grep -rIlE '(FAL_KEY|TAVILY_API_KEY|PARALLEL_API_KEY|JEV_API_KEY)[[:space:]]*=[[:space:]]*[A-Za-z0-9_-]{12,}' "$SRC"; then
  echo "a key value is present in the skill folder"; exit 1
fi

echo "== stage"
rm -rf "$OUT/stage" "$OUT/recliner-skill.zip"
mkdir -p "$STAGE"
cp -R "$SRC/." "$STAGE/"
find "$STAGE" \( -name '.DS_Store' -o -name '*.tmp' -o -name '*.log' \) -delete
rm -rf "$STAGE/runs" "$STAGE/node_modules"
# The contracts live in docs/ in the repo; the package carries its own copy.
cp "$ROOT/docs/CONTRACTS.md" "$STAGE/CONTRACTS.md"
for f in "$STAGE/SKILL.md" "$STAGE"/steps/*.md; do
  sed 's#`docs/CONTRACTS\.md`#`CONTRACTS.md` (in this skill folder)#g; s#docs/CONTRACTS\.md#CONTRACTS.md#g' "$f" > "$f.new" && mv "$f.new" "$f"
done
# Deterministic technical validation (Python, standard library only) travels with the skill.
cp -R "$ROOT/validation" "$STAGE/validation"
find "$STAGE/validation" -name '__pycache__' -type d -prune -exec rm -rf {} +
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
cat > "$STAGE/INSTALL.md" <<'EOF'
# Installing the /recliner skill

1. Unzip so the folder sits at one of:
   - `~/.claude/skills/recliner/` (available in every workspace), or
   - `<your project>/.claude/skills/recliner/` (that project only).
2. In the workspace you will run it from, create `.env` with `FAL_KEY=...`
   (optional: `TAVILY_API_KEY`, `PARALLEL_API_KEY`, `JEV_API_KEY`). You can also enter the fal key on the Brief page.
3. Check the machine: `node ~/.claude/skills/recliner/bin/recliner.mjs doctor`
   Required: Node 22+, ffmpeg. Recommended: Blender, yt-dlp, rsvg-convert, Python 3.11+ (technical validation).
4. In a local agent session (for example Claude Code) opened in that workspace:
   - `/recliner new content for <topic>` opens the Brief page (local, 127.0.0.1 only).
   - `/recliner path/to/brief.md --effort 2` runs headless.

Runs are written to `runs/` and exports to `outputs/` in the workspace. Nothing is hosted.
EOF

echo "== smoke test (empty workspace, no keys, no network)"
WS=$(mktemp -d)
( cd "$WS" && printf '# Test product\n\nURL: https://example.com\n\nA test brief.\n' > brief.md \
  && node "$STAGE/bin/recliner.mjs" > /dev/null \
  && node "$STAGE/bin/recliner.mjs" new-run --slug smoke --brief brief.md --effort 1 > run.json \
  && RUN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('run.json','utf8')).runId)") \
  && for f in brief.json config.json state.json traces.json; do [ -f "runs/$RUN/$f" ] || { echo "smoke: runs/$RUN/$f missing"; exit 1; }; done \
  && node "$STAGE/bin/recliner.mjs" stage "$RUN" references running > /dev/null \
  && ( cd "$STAGE" && python3 -m validation.run --help > /dev/null ) \
  && echo "smoke ok: $RUN" )
rm -rf "$WS"
if grep -rn 'docs/CONTRACTS' "$STAGE/SKILL.md" "$STAGE/steps"; then echo "dead reference to docs/ in the package"; exit 1; fi

echo "== zip"
( cd "$OUT/stage" && zip -qr "$OUT/recliner-skill.zip" recliner )
rm -rf "$OUT/stage"
ls -lh "$OUT/recliner-skill.zip" | awk '{print $5, $9}'
echo "version $VERSION"
