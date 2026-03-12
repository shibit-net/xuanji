#!/bin/bash
# 终端滚动问题修复 - 快速测试脚本

echo "================================================"
echo "  终端滚动问题修复 - 测试脚本"
echo "================================================"
echo ""

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ 请在项目根目录运行此脚本"
    exit 1
fi

echo "📦 步骤 1: 编译项目..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查错误信息"
    exit 1
fi

echo ""
echo "✅ 编译成功！"
echo ""
echo "================================================"
echo "  请按照以下步骤测试："
echo "================================================"
echo ""
echo "1️⃣  测试长文本输出（容易触发滚动问题）："
echo "   运行: npm run dev"
echo "   输入: 分析一下这个项目的目录结构"
echo "   观察: AI 输出完成后是否还会向上滚动"
echo ""
echo "2️⃣  测试工具调用："
echo "   输入: 查看 package.json 的内容"
echo "   观察: 工具执行完成后是否还会滚动"
echo ""
echo "3️⃣  测试流式输出："
echo "   输入: 写一首关于编程的诗"
echo "   观察: 输出过程中的流畅度"
echo ""
echo "================================================"
echo "  预期效果："
echo "================================================"
echo ""
echo "✅ AI 输出完成后，终端不再自动向上滚动"
echo "✅ 用户可以自然地向下阅读完整内容"
echo "✅ 输入框始终保持在底部可见"
echo "✅ 状态栏在 thinking/tool 状态时隐藏"
echo ""
echo "================================================"
echo "  如果问题仍然存在："
echo "================================================"
echo ""
echo "1. 查看详细分析: cat SCROLL_ISSUE_FIX.md"
echo "2. 查看应用记录: cat SCROLL_FIX_APPLIED.md"
echo "3. 尝试在不同终端中测试（iTerm2/Terminal.app/Warp）"
echo "4. 检查终端配置的滚动行为设置"
echo ""
echo "现在开始测试吗？(y/n)"
read -r answer

if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    echo ""
    echo "🚀 启动 xuanji..."
    echo ""
    npm run dev
else
    echo ""
    echo "稍后可以运行 'npm run dev' 开始测试"
    echo ""
fi
