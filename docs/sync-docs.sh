#!/bin/bash
set -e
DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$DOCS_DIR")"

echo "Syncing adk-go docs..."
rsync -a --delete "$BASE_DIR/adk-go/docs/" "$DOCS_DIR/adk-go/"
cp "$DOCS_DIR/adk-go/README.md" "$DOCS_DIR/adk-go/index.md"

echo "Syncing eino docs..."
rsync -a --delete "$BASE_DIR/eino/docs/" "$DOCS_DIR/eino/"
cp "$DOCS_DIR/eino/README.md" "$DOCS_DIR/eino/index.md"

echo "Syncing agentscope-java docs..."
rsync -a --delete "$BASE_DIR/agentscope-java/docs/" "$DOCS_DIR/agentscope/java/"
cp "$DOCS_DIR/agentscope/java/README.md" "$DOCS_DIR/agentscope/java/index.md"

echo "Done! All docs synced."
