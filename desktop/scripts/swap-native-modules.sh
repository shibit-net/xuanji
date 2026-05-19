#!/bin/bash
# swap-native-modules.sh — 为不同架构切换原生 Node 模块二进制
# 用法: ./scripts/swap-native-modules.sh [x64|arm64]

set -euo pipefail
ARCH="${1:-}"

if [ "$ARCH" != "x64" ] && [ "$ARCH" != "arm64" ]; then
  echo "Usage: $0 [x64|arm64]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$DESKTOP_DIR/build/native-modules"

echo "[swap-native] 切换原生模块到 $ARCH ..."

# better-sqlite3 (desktop node_modules)
BETTER_SQLITE3_DESKTOP="$DESKTOP_DIR/node_modules/better-sqlite3/build/Release"
if [ -d "$BETTER_SQLITE3_DESKTOP" ]; then
  cp "$NATIVE_DIR/$ARCH/better_sqlite3.node" "$BETTER_SQLITE3_DESKTOP/better_sqlite3.node"
  echo "  ✓ better-sqlite3 (desktop) → $ARCH"
fi

# better-sqlite3 (parent node_modules, used by extraResources)
BETTER_SQLITE3_PARENT="$DESKTOP_DIR/../node_modules/better-sqlite3/build/Release"
if [ -d "$BETTER_SQLITE3_PARENT" ]; then
  cp "$NATIVE_DIR/$ARCH/better_sqlite3.node" "$BETTER_SQLITE3_PARENT/better_sqlite3.node"
  echo "  ✓ better-sqlite3 (parent) → $ARCH"
fi

echo "[swap-native] 完成"
