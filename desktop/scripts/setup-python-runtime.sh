#!/bin/bash
# =============================================================================
# 下载并准备 Python 运行时（用于 .xls 解析器回退）
#
# 用法: bash setup-python-runtime.sh [arch]
#   arch: x64 | arm64 (默认 x64)
#
# 下载 python-build-standalone (astral-sh) 并安装 xlrd，输出到 python-runtime/
# xlrd 零外部依赖，总体积 ~25MB
# 支持 macOS (apple-darwin) 和 Windows (pc-windows-msvc)
# =============================================================================
set -euo pipefail

# Platform detection
OS="$(uname -s 2>/dev/null || echo 'Windows')"
case "$OS" in
  Darwin)  OS_TARGET="apple-darwin" ;;
  Linux)   OS_TARGET="unknown-linux-gnu" ;;
  MINGW*|MSYS*|CYGWIN*|Windows) OS_TARGET="pc-windows-msvc" ;;
  *) echo "ERROR: unsupported OS: $OS"; exit 1 ;;
esac

# Auto-detect architecture if not specified
if [ $# -ge 1 ]; then
  ARCH="$1"
else
  case "$(uname -m)" in
    x86_64)  ARCH="x64" ;;
    i686|i386) ARCH="x64" ;;  # MSYS/Git Bash on 64-bit Windows reports i686
    arm64)   ARCH="arm64" ;;
    aarch64) ARCH="arm64" ;;
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
TARBALL="cpython-${PYTHON_VERSION}%2B${RELEASE_TAG}-${PBS_ARCH}-${OS_TARGET}-install_only.tar.gz"
DOWNLOAD_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${TARBALL}"

echo "=== Python Runtime Setup (OS: $OS_TARGET, arch: $ARCH) ==="

# ── Determine python binary path (differs by platform)
_is_windows=false
_python_bin=""
if [ "$OS_TARGET" = "pc-windows-msvc" ]; then
  _is_windows=true
  _python_bin="$RUNTIME_DIR/python/python.exe"
else
  _python_bin="$RUNTIME_DIR/python/bin/python3"
fi

# Check if runtime already exists and is valid
if [ -f "$RUNTIME_DIR/xls-convert.py" ] && [ -f "$_python_bin" ]; then
  if "$_python_bin" -c "import xlrd" 2>/dev/null; then
    echo "Python runtime already set up and valid, skipping."
    echo "Total size: $(du -sh "$RUNTIME_DIR" 2>/dev/null | cut -f1)"
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
  echo "Downloading Python runtime (${OS_TARGET}, ~24MB)..."
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

if [ ! -f "$_python_bin" ]; then
  echo "ERROR: python binary not found after extraction (expected: $_python_bin)"
  ls -la "$RUNTIME_DIR/"
  exit 1
fi

# Install xlrd (~1MB, zero deps)
echo "Installing xlrd..."
"$_python_bin" -m pip install --quiet --no-cache-dir xlrd 2>&1 | tail -1

if ! "$_python_bin" -c "import xlrd" 2>/dev/null; then
  echo "ERROR: Failed to install xlrd"
  exit 1
fi

# Copy the conversion script
cp "$SCRIPT_DIR/xls-convert.py" "$RUNTIME_DIR/"

# Clean up test/idle/lib dist to reduce size
if $_is_windows; then
  rm -rf "$PYTHON_DIR/Lib/test" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/idlelib" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/Lib/distutils" 2>/dev/null || true
else
  rm -rf "$PYTHON_DIR/lib/python3.12/test" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/idlelib" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/turtledemo" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/ensurepip" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/share" 2>/dev/null || true
  rm -rf "$PYTHON_DIR/lib/python3.12/distutils" 2>/dev/null || true
fi

echo ""
echo "=== Setup Complete ==="
echo "Runtime dir: $RUNTIME_DIR"
echo "Total size: $(du -sh "$RUNTIME_DIR" 2>/dev/null | cut -f1)"
"$_python_bin" --version
"$_python_bin" -c 'import xlrd; print(f"xlrd: {xlrd.__VERSION__}")'
