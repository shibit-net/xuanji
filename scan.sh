#!/bin/bash
ls -la /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/
echo "==="
find /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.json" -o -name "*.md" \) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" 2>/dev/null | sort
