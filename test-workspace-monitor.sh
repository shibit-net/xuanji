#!/bin/bash

# ============================================================
# Work Space Monitor 测试脚本
# ============================================================

echo "🎯 Work Space Monitor 测试"
echo "================================"
echo ""

# 检查依赖
echo "📦 检查依赖..."
cd /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/desktop
if [ ! -d "node_modules" ]; then
  echo "❌ 依赖未安装，正在安装..."
  npm install
fi

echo "✅ 依赖检查完成"
echo ""

# TypeScript 类型检查
echo "🔍 TypeScript 类型检查..."
npm run typecheck 2>&1 | grep -E "(WorkspaceMonitor|error TS)" | head -20

if [ $? -eq 0 ]; then
  echo "⚠️  发现类型错误（见上方）"
else
  echo "✅ 类型检查通过"
fi
echo ""

# 启动 GUI
echo "🚀 启动 GUI..."
echo ""
echo "测试步骤："
echo "1. 观察右侧 Work Space Monitor 面板"
echo "2. 发送消息：'读取 package.json 文件'"
echo "3. 观察主 Agent 状态变化（蓝色脉冲 → 绿色旋转）"
echo "4. 观察子 Agent（Read 工具）出现"
echo "5. 观察粒子流动动画"
echo "6. 观察 Token 统计更新"
echo ""
echo "按 Ctrl+C 停止测试"
echo ""

cd /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji
npm run dev:gui
