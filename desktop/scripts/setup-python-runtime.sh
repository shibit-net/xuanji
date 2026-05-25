#!/bin/bash
# =============================================================================
# 下载并准备 Python 运行时（用于 .xls 解析器回退）
#
# 用法: bash setup-python-runtime.sh [arch]
#   arch: x64 | arm64 (默认 x64)
#
# 下载 python-build-standalone (astral-sh) 并安装 xlrd，输出到 python-runtime/
# xlrd 零外部依赖，总体积 ~25MB
# =============================================================================
set -euo pipefail

# Auto-detect architecture if not specified
if [ $# -ge 1 ]; then
  ARCH="$1"
else
  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    arm64)  ARCH="arm64" ;;
    *) echo "ERROR: unknown arch $(uname -m)"; exit 1 ;;
  esac
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
RUNTIME_DIR="$DESKTOP_DIR/python-runtime"

# Map to python-build-standalone arch names
if [ "$ARCH" = "x64" ]; then
  PBS_ARCH="x86_64"
elif [ "$ARCH" = "arm64" ]; then
  PBS_ARCH="aarch64"
else
  echo "ERROR: unsupported arch: $ARCH (expected x64 or arm64)"
  exit 1
fi

PYTHON_VERSION="3.12.13"
RELEASE_TAG="20260510"
# Note: %2B is URL-encoded '+'
TARBALL="cpython-${PYTHON_VERSION}%2B${RELEASE_TAG}-${PBS_ARCH}-apple-darwin-install_only.tar.gz"
DOWNLOAD_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${TARBALL}"

echo "=== Python Runtime Setup (arch: $ARCH) ==="

# Check if runtime already exists and is valid
if [ -f "$RUNTIME_DIR/xls-convert.py" ] && [ -f "$RUNTIME_DIR/python/bin/python3" ]; then
  if "$RUNTIME_DIR/python/bin/python3" -c "import xlrd" 2>/dev/null; then
    echo "Python runtime already set up and valid, skipping."
    echo "Size: $(du -sh "$RUNTIME_DIR" | cut -f1)"
    exit 0
  fi
fi

echo "Setting up Python runtime..."
echo ""

# Create runtime directory
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"

# Download python-build-standalone if not already cached
CACHE_DIR="/tmp/xuanji-python-cache"
mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/${TARBALL//%2B/+}"

if [ ! -f "$CACHE_FILE" ]; then
  echo "Downloading Python runtime (~24MB)..."
  curl -sSL -o "$CACHE_FILE" "$DOWNLOAD_URL"
else
  echo "Using cached Python runtime."
fi

FILE_SIZE=$(stat -f%z "$CACHE_FILE" 2>/dev/null || stat -c%s "$CACHE_FILE" 2>/dev/null || echo 0)
if [ "$FILE_SIZE" -lt 100000 ]; then
  echo "ERROR: Downloaded file too small (${FILE_SIZE} bytes). Check URL."
  exit 1
fi

# Extract Python
echo "Extracting..."
tar -xzf "$CACHE_FILE" -C "$RUNTIME_DIR"
PYTHON_DIR="$RUNTIME_DIR/python"

if [ ! -f "$PYTHON_DIR/bin/python3" ]; then
  echo "ERROR: python3 binary not found after extraction"
  ls -la "$RUNTIME_DIR/"
  exit 1
fi

# Install xlrd (~1MB, zero deps)
echo "Installing xlrd..."
"$PYTHON_DIR/bin/python3" -m pip install --quiet --no-cache-dir xlrd 2>&1 | tail -1

if ! "$PYTHON_DIR/bin/python3" -c "import xlrd" 2>/dev/null; then
  echo "ERROR: Failed to install xlrd"
  exit 1
fi

# Copy the conversion script
cp "$SCRIPT_DIR/xls-convert.py" "$RUNTIME_DIR/"

# Clean up test/idle/lib dist to reduce size
rm -rf "$PYTHON_DIR/lib/python3.12/test" 2>/dev/null || true
rm -rf "$PYTHON_DIR/lib/python3.12/idlelib" 2>/dev/null || true
rm -rf "$PYTHON_DIR/lib/python3.12/turtledemo" 2>/dev/null || true
rm -rf "$PYTHON_DIR/lib/python3.12/ensurepip" 2>/dev/null || true
rm -rf "$PYTHON_DIR/share" 2>/dev/null || true
rm -rf "$PYTHON_DIR/lib/python3.12/distutils" 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo "Runtime dir: $RUNTIME_DIR"
echo "Total size: $(du -sh "$RUNTIME_DIR" | cut -f1)"
"$PYTHON_DIR/bin/python3" --version
"$PYTHON_DIR/bin/python3" -c 'import xlrd; print(f"xlrd: {xlrd.__VERSION__}")'
