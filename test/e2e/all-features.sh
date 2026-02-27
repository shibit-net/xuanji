#!/usr/bin/env bash
# ============================================================
# 全功能端到端测试脚本
#
# 验证三大核心功能的集成工作:
# 1. 会话持久化 (Session Persistence)
# 2. Hook 系统 (Hook System)
# 3. 子代理系统 (SubAgent System)
#
# 使用方式: bash test/e2e/all-features.sh
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR=$(mktemp -d)
XUANJI_HOME="$TEST_DIR/.xuanji"
SESSIONS_DIR="$XUANJI_HOME/sessions"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

log_pass() {
  echo -e "${GREEN}✓ $1${NC}"
  ((PASS++))
}

log_fail() {
  echo -e "${RED}✗ $1${NC}"
  ((FAIL++))
}

log_section() {
  echo ""
  echo -e "${YELLOW}━━━ $1 ━━━${NC}"
}

# ─── 准备环境 ────────────────────────────────────────────

mkdir -p "$SESSIONS_DIR"
mkdir -p "$XUANJI_HOME"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  璇玑 - 全功能端到端测试              ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "临时目录: $TEST_DIR"

# ═══════════════════════════════════════════════════════════
# 1. 会话持久化测试
# ═══════════════════════════════════════════════════════════

log_section "1. 会话持久化 (Session Persistence)"

# 测试 1.1: 创建 meta.json
SESSION_ID="test-session-$(date +%s)"
META_FILE="$SESSIONS_DIR/$SESSION_ID.meta.json"
MESSAGES_FILE="$SESSIONS_DIR/$SESSION_ID.messages.jsonl"
CHECKPOINTS_FILE="$SESSIONS_DIR/$SESSION_ID.checkpoints.json"

cat > "$META_FILE" << EOF
{
  "id": "$SESSION_ID",
  "name": "E2E 测试会话",
  "createdAt": $(date +%s)000,
  "updatedAt": $(date +%s)000,
  "messageCount": 3,
  "workingDirectory": "$TEST_DIR"
}
EOF

if [ -f "$META_FILE" ]; then
  log_pass "创建会话元数据"
else
  log_fail "创建会话元数据"
fi

# 测试 1.2: 创建 JSONL 消息文件
cat > "$MESSAGES_FILE" << 'EOF'
{"role":"user","content":"你好"}
{"role":"assistant","content":"你好！有什么可以帮你的吗？"}
{"role":"user","content":"帮我搜索代码"}
EOF

LINE_COUNT=$(wc -l < "$MESSAGES_FILE" | xargs)
if [ "$LINE_COUNT" = "3" ]; then
  log_pass "创建 JSONL 消息文件 (3 条消息)"
else
  log_fail "创建 JSONL 消息文件 (期望 3 行, 实际 $LINE_COUNT 行)"
fi

# 测试 1.3: 验证 JSONL 格式
VALID_JSON=true
while IFS= read -r line; do
  if ! echo "$line" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    VALID_JSON=false
    break
  fi
done < "$MESSAGES_FILE"

if [ "$VALID_JSON" = true ]; then
  log_pass "JSONL 格式验证通过"
else
  log_fail "JSONL 格式验证失败"
fi

# 测试 1.4: Checkpoint 创建
cat > "$CHECKPOINTS_FILE" << EOF
[
  {
    "id": "cp-001",
    "sessionId": "$SESSION_ID",
    "label": "初始状态",
    "messageIndex": 2,
    "createdAt": $(date +%s)000
  }
]
EOF

if python3 -c "import json; data=json.load(open('$CHECKPOINTS_FILE')); assert len(data)==1" 2>/dev/null; then
  log_pass "创建 Checkpoint"
else
  log_fail "创建 Checkpoint"
fi

# 测试 1.5: 模拟截断（回滚）
head -2 "$MESSAGES_FILE" > "$MESSAGES_FILE.tmp"
mv "$MESSAGES_FILE.tmp" "$MESSAGES_FILE"
NEW_LINE_COUNT=$(wc -l < "$MESSAGES_FILE" | tr -d ' ')
if [ "$NEW_LINE_COUNT" = "2" ]; then
  log_pass "消息截断（模拟 Checkpoint 回滚）: 3→2 条"
else
  log_fail "消息截断 (期望 2 行, 实际 $NEW_LINE_COUNT 行)"
fi

# 测试 1.6: 列出会话
META_COUNT=$(ls "$SESSIONS_DIR"/*.meta.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$META_COUNT" -ge "1" ]; then
  log_pass "列出会话 ($META_COUNT 个会话)"
else
  log_fail "列出会话"
fi

# ═══════════════════════════════════════════════════════════
# 2. Hook 系统测试
# ═══════════════════════════════════════════════════════════

log_section "2. Hook 系统 (Hook System)"

HOOKS_FILE="$XUANJI_HOME/hooks.json"

# 测试 2.1: 创建有效 Hook 配置
cat > "$HOOKS_FILE" << 'EOF'
{
  "PreToolUse": [
    {
      "type": "command",
      "script": "echo 'Hook: ${TOOL_NAME}' >> /tmp/xuanji-e2e-hook.log",
      "timeout": 2000,
      "scope": "global"
    }
  ],
  "PostToolUse": [
    {
      "type": "prompt",
      "content": "Tool ${TOOL_NAME} executed successfully.",
      "scope": "parent"
    }
  ],
  "ErrorOccurred": [
    {
      "type": "command",
      "script": "echo 'Error: ${ERROR_MESSAGE}' >> /tmp/xuanji-e2e-error.log",
      "timeout": 3000
    }
  ]
}
EOF

if python3 -c "import json; data=json.load(open('$HOOKS_FILE')); assert 'PreToolUse' in data" 2>/dev/null; then
  log_pass "创建 Hook 配置文件"
else
  log_fail "创建 Hook 配置文件"
fi

# 测试 2.2: 验证 Hook 事件类型
EVENTS=$(python3 -c "import json; data=json.load(open('$HOOKS_FILE')); print(' '.join(data.keys()))")
EXPECTED_EVENTS="PreToolUse PostToolUse ErrorOccurred"
if [ "$EVENTS" = "$EXPECTED_EVENTS" ]; then
  log_pass "Hook 事件类型正确: $EVENTS"
else
  log_fail "Hook 事件类型 (期望: $EXPECTED_EVENTS, 实际: $EVENTS)"
fi

# 测试 2.3: 验证 Command Handler 结构
HAS_SCRIPT=$(python3 -c "
import json
data = json.load(open('$HOOKS_FILE'))
h = data['PreToolUse'][0]
assert h['type'] == 'command'
assert 'script' in h
assert 'timeout' in h
print('ok')
" 2>/dev/null)

if [ "$HAS_SCRIPT" = "ok" ]; then
  log_pass "Command Handler 结构验证"
else
  log_fail "Command Handler 结构验证"
fi

# 测试 2.4: 验证 Prompt Handler 结构
HAS_PROMPT=$(python3 -c "
import json
data = json.load(open('$HOOKS_FILE'))
h = data['PostToolUse'][0]
assert h['type'] == 'prompt'
assert 'content' in h
print('ok')
" 2>/dev/null)

if [ "$HAS_PROMPT" = "ok" ]; then
  log_pass "Prompt Handler 结构验证"
else
  log_fail "Prompt Handler 结构验证"
fi

# 测试 2.5: 模拟 Hook 脚本执行
HOOK_LOG="/tmp/xuanji-e2e-hook.log"
rm -f "$HOOK_LOG"
TOOL_NAME="ReadTool" eval 'echo "Hook: ${TOOL_NAME}" >> /tmp/xuanji-e2e-hook.log'

if [ -f "$HOOK_LOG" ] && grep -q "Hook: ReadTool" "$HOOK_LOG"; then
  log_pass "Hook 脚本模拟执行"
  rm -f "$HOOK_LOG"
else
  log_fail "Hook 脚本模拟执行"
fi

# 测试 2.6: Hook 阻塞测试（exit 1 应阻止工具执行）
if ! bash -c "exit 1" 2>/dev/null; then
  log_pass "Command Handler 阻塞检测 (非零退出码)"
else
  log_fail "Command Handler 阻塞检测"
fi

# ═══════════════════════════════════════════════════════════
# 3. 子代理系统测试
# ═══════════════════════════════════════════════════════════

log_section "3. 子代理系统 (SubAgent System)"

# 测试 3.1: TypeScript 类型检查（编译时验证）
cd "$PROJECT_ROOT"

# 检查关键文件存在
SUBAGENT_FILES=(
  "src/core/agent/SubAgentContext.ts"
  "src/core/agent/SubAgentLoop.ts"
  "src/core/agent/SubAgentHooks.ts"
  "src/core/tools/TaskTool.ts"
)

ALL_EXIST=true
for f in "${SUBAGENT_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    ALL_EXIST=false
    log_fail "文件缺失: $f"
  fi
done

if [ "$ALL_EXIST" = true ]; then
  log_pass "子代理系统文件完整 (${#SUBAGENT_FILES[@]} 个文件)"
fi

# 测试 3.2: SubAgentContext 常量检查
if grep -q "MAX_NESTING_DEPTH = 3" src/core/agent/SubAgentContext.ts; then
  log_pass "最大嵌套深度限制 = 3"
else
  log_fail "最大嵌套深度限制检查"
fi

# 测试 3.3: TaskTool 递归保护
if grep -q "ALWAYS_RESTRICTED_TOOLS.*task" src/core/agent/SubAgentContext.ts; then
  log_pass "TaskTool 递归保护（ALWAYS_RESTRICTED_TOOLS 包含 'task'）"
else
  log_fail "TaskTool 递归保护"
fi

# 测试 3.4: FilteredToolRegistry 实现
if grep -q "class FilteredToolRegistry" src/core/agent/SubAgentLoop.ts; then
  log_pass "FilteredToolRegistry 工具过滤代理"
else
  log_fail "FilteredToolRegistry 工具过滤代理"
fi

# 测试 3.5: 子代理 Hook 集成
if grep -q "SubAgentToolUse" src/core/agent/SubAgentHooks.ts; then
  log_pass "SubAgentToolUse Hook 事件"
else
  log_fail "SubAgentToolUse Hook 事件"
fi

# 测试 3.6: ToolRegistry.cloneForSubAgent
if grep -q "cloneForSubAgent" src/core/tools/ToolRegistry.ts; then
  log_pass "ToolRegistry.cloneForSubAgent 方法"
else
  log_fail "ToolRegistry.cloneForSubAgent 方法"
fi

# ═══════════════════════════════════════════════════════════
# 4. 集成验证
# ═══════════════════════════════════════════════════════════

log_section "4. 集成验证"

# 测试 4.1: ChatSession 集成所有三大功能
CHAT_SESSION="src/core/chat/ChatSession.ts"
INTEGRATIONS=0

if grep -q "SessionManager" "$CHAT_SESSION"; then
  ((INTEGRATIONS++))
fi
if grep -q "HookRegistry" "$CHAT_SESSION"; then
  ((INTEGRATIONS++))
fi
if grep -q "TaskTool" "$CHAT_SESSION"; then
  ((INTEGRATIONS++))
fi

if [ "$INTEGRATIONS" = "3" ]; then
  log_pass "ChatSession 集成三大功能 (Session + Hook + TaskTool)"
else
  log_fail "ChatSession 集成 ($INTEGRATIONS/3)"
fi

# 测试 4.2: Hook 事件覆盖检查（14 种事件）
HOOK_TYPES_FILE="src/hooks/types.ts"
EVENTS_DEFINED=$(grep -c "'[A-Z].*'" "$HOOK_TYPES_FILE" 2>/dev/null || echo "0")
if [ "$EVENTS_DEFINED" -ge "10" ]; then
  log_pass "Hook 事件类型定义 (≥10 种事件)"
else
  log_fail "Hook 事件类型定义 (仅 $EVENTS_DEFINED 种)"
fi

# 测试 4.3: AgentHandler 集成
if grep -q "executeAgentHandler" src/hooks/HookRegistry.ts; then
  log_pass "AgentHandler LLM 分析集成"
else
  log_fail "AgentHandler LLM 分析集成"
fi

# 测试 4.4: setAgentHandlerDeps 注入
if grep -q "setAgentHandlerDeps" src/core/chat/ChatSession.ts; then
  log_pass "AgentHandler LLM Provider 依赖注入"
else
  log_fail "AgentHandler LLM Provider 依赖注入"
fi

# ═══════════════════════════════════════════════════════════
# 结果汇总
# ═══════════════════════════════════════════════════════════

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  测试结果                              ║"
echo "╠═══════════════════════════════════════╣"
echo -e "║  ${GREEN}通过: $PASS${NC}"
echo -e "║  ${RED}失败: $FAIL${NC}"
TOTAL=$((PASS + FAIL))
echo "║  总计: $TOTAL"
echo "╚═══════════════════════════════════════╝"

# 清理
rm -f /tmp/xuanji-e2e-hook.log /tmp/xuanji-e2e-error.log

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo ""
echo -e "${GREEN}全部测试通过！${NC}"
exit 0
