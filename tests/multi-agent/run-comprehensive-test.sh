#!/bin/bash

# Xuanji Multi-Agent Comprehensive Test Runner
# 
# This script runs the comprehensive multi-agent test suite and captures results

set -e

echo "🚀 Xuanji Multi-Agent Comprehensive Test Suite"
echo "=============================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: Must run from project root directory"
  exit 1
fi

# Ensure test directory exists
mkdir -p tests/multi-agent

# Check dependencies
echo "📦 Checking dependencies..."
if ! npm list @anthropic-ai/sdk &>/dev/null; then
  echo "⚠️ Installing dependencies..."
  npm install
fi

echo "✅ Dependencies OK"
echo ""

# Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run build

echo "✅ Compilation complete"
echo ""

# Run the test suite
echo "🧪 Starting test execution..."
echo ""

npx tsx tests/multi-agent/comprehensive-test.ts

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Test suite completed successfully"
  echo ""
  echo "📄 Reports generated in tests/multi-agent/"
  ls -lh tests/multi-agent/test-report-*.md 2>/dev/null | tail -1 || echo "No reports found"
else
  echo "❌ Test suite failed with exit code $EXIT_CODE"
fi

echo ""
exit $EXIT_CODE
