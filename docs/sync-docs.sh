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

echo "Syncing a2a docs..."
rsync -a --delete --exclude='source' "$BASE_DIR/a2a/" "$DOCS_DIR/a2a/"
rm -f "$DOCS_DIR/a2a/index.md"
cp "$DOCS_DIR/a2a/README.md" "$DOCS_DIR/a2a/index.md"

echo "Syncing mcp docs..."
rsync -a --delete --exclude='source' "$BASE_DIR/mcp/" "$DOCS_DIR/mcp/"
rm -f "$DOCS_DIR/mcp/index.md"
cp "$DOCS_DIR/mcp/README.md" "$DOCS_DIR/mcp/index.md"

echo "Syncing pydantic-ai docs..."
rsync -a --delete --exclude='source' "$BASE_DIR/pydantic-ai/" "$DOCS_DIR/pydantic-ai/"
rm -f "$DOCS_DIR/pydantic-ai/index.md"
cp "$DOCS_DIR/pydantic-ai/README.md" "$DOCS_DIR/pydantic-ai/index.md"

echo "Syncing langchain docs..."
rsync -a --delete --exclude='source' "$BASE_DIR/langchain/" "$DOCS_DIR/langchain/"
rm -f "$DOCS_DIR/langchain/index.md"
cp "$DOCS_DIR/langchain/README.md" "$DOCS_DIR/langchain/index.md"

echo "Done! All docs synced."
