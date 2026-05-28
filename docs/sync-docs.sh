#!/bin/bash
set -e
DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$DOCS_DIR")"

sync_dir() {
  local src="$1" dest="$2" index_src="$3"
  if [ ! -d "$src" ]; then
    echo "Skipping $(basename "$dest") (source not found: $src)"
    return 0
  fi
  mkdir -p "$dest"
  rsync -a --delete \
    --exclude='source' \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='uv.lock' \
    --exclude='*.pyc' \
    "$src" "$dest"
  rm -f "$dest/index.md"
  cp "$index_src" "$dest/index.md"
}

echo "Syncing adk-go docs..."
sync_dir "$BASE_DIR/adk-go/docs/" "$DOCS_DIR/adk-go/" "$DOCS_DIR/adk-go/README.md"

echo "Syncing eino docs..."
sync_dir "$BASE_DIR/eino/docs/" "$DOCS_DIR/eino/" "$DOCS_DIR/eino/README.md"

echo "Syncing agentscope-java docs..."
sync_dir "$BASE_DIR/agentscope-java/docs/" "$DOCS_DIR/agentscope/java/" "$DOCS_DIR/agentscope/java/README.md"

echo "Syncing hiclaw docs..."
sync_dir "$BASE_DIR/hiclaw/docs/" "$DOCS_DIR/hiclaw/" "$DOCS_DIR/hiclaw/learning/README.md"

echo "Syncing a2a docs..."
sync_dir "$BASE_DIR/a2a/" "$DOCS_DIR/a2a/" "$DOCS_DIR/a2a/README.md"

echo "Syncing mcp docs..."
sync_dir "$BASE_DIR/mcp/" "$DOCS_DIR/mcp/" "$DOCS_DIR/mcp/README.md"

echo "Syncing pydantic-ai docs..."
sync_dir "$BASE_DIR/pydantic-ai/" "$DOCS_DIR/pydantic-ai/" "$DOCS_DIR/pydantic-ai/README.md"

echo "Syncing langchain docs..."
sync_dir "$BASE_DIR/langchain/" "$DOCS_DIR/langchain/" "$DOCS_DIR/langchain/README.md"

echo "Done! All docs synced."
