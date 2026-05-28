#!/bin/bash
set -e
DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$DOCS_DIR")"

echo "Syncing adk-go docs..."
rsync -a --delete "$BASE_DIR/adk-go/docs/" "$DOCS_DIR/adk-go/"
rm -f "$DOCS_DIR/adk-go/index.md"
cp "$DOCS_DIR/adk-go/README.md" "$DOCS_DIR/adk-go/index.md"

echo "Syncing eino docs..."
rsync -a --delete "$BASE_DIR/eino/docs/" "$DOCS_DIR/eino/"
rm -f "$DOCS_DIR/eino/index.md"
cp "$DOCS_DIR/eino/README.md" "$DOCS_DIR/eino/index.md"

echo "Syncing agentscope-java docs..."
rsync -a --delete "$BASE_DIR/agentscope-java/docs/" "$DOCS_DIR/agentscope/java/"
rm -f "$DOCS_DIR/agentscope/java/index.md"
cp "$DOCS_DIR/agentscope/java/README.md" "$DOCS_DIR/agentscope/java/index.md"

echo "Syncing hiclaw docs..."
rsync -a --delete "$BASE_DIR/hiclaw/docs/" "$DOCS_DIR/hiclaw/"
rm -f "$DOCS_DIR/hiclaw/index.md"
cp "$DOCS_DIR/hiclaw/learning/README.md" "$DOCS_DIR/hiclaw/index.md"

echo "Done! All docs synced."
