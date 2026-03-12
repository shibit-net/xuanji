#!/bin/bash

# 并行工具 UI 优化 - 快速测试脚本

echo "========================================="
echo "并行工具 UI 优化 - 测试场景"
echo "========================================="
echo ""

# 确保在项目根目录
cd "$(dirname "$0")"

# 编译项目
echo "📦 编译项目..."
npm run build > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查代码"
    exit 1
fi

echo "✅ 编译成功"
echo ""

# 运行 CLI
echo "🚀 启动 Xuanji CLI..."
echo ""
echo "请尝试以下测试场景:"
echo ""
echo "场景 1 - 多个文件并行读取:"
echo "  请同时读取 package.json、tsconfig.json、README.md 这三个文件"
echo ""
echo "场景 2 - 混合并行和串行:"
echo "  先读取 package.json，然后同时搜索 src 目录中的 import 语句和 export 语句"
echo ""
echo "场景 3 - 大量并行工具:"
echo "  请读取 src/adapters/cli 目录下的所有 TypeScript 文件"
echo ""
echo "========================================="
echo ""

# 启动 CLI
npm start
