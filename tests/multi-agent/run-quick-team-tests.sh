#!/bin/bash

# QuickTeamTool 模板测试脚本
# 测试所有预定义模板并收集详细数据

echo "==================================================================="
echo "QuickTeamTool 模板测试 - 开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================================="
echo ""

# 创建输出目录
OUTPUT_DIR="tests/multi-agent/quick-team-results"
mkdir -p "$OUTPUT_DIR"

# 测试 1: code-review 模板
echo "📝 测试 1/3: code-review 模板"
echo "-------------------------------------------------------------------"
echo "目标: 审查 src/core/tools/QuickTeamTool.ts"
echo "预期策略: sequential (architecture → security → performance)"
echo ""

cat > /tmp/quick-team-test-1.txt << 'EOF'
使用 quick_team 工具测试 code-review 模板：

请审查 src/core/tools/QuickTeamTool.ts 的代码质量。
重点关注：
1. 架构设计是否合理
2. 是否存在安全隐患
3. 性能优化空间

template: code-review
goal: Review src/core/tools/QuickTeamTool.ts for code quality, security, and performance
target: src/core/tools/QuickTeamTool.ts

请记录：
- 执行时间
- Token 使用
- 各成员发现的问题
- 团队协作效果
EOF

echo "测试输入已准备，等待手动执行..."
echo ""

# 测试 2: research 模板
echo "🔍 测试 2/3: research 模板"
echo "-------------------------------------------------------------------"
echo "目标: 调研 TypeScript multi-agent 架构"
echo "预期策略: parallel (docs + code + community)"
echo ""

cat > /tmp/quick-team-test-2.txt << 'EOF'
使用 quick_team 工具测试 research 模板：

请调研 TypeScript multi-agent system 的架构最佳实践。
需要覆盖：
1. 官方文档和学术资料
2. 开源代码示例
3. 社区实践经验

template: research
goal: Research TypeScript multi-agent system architecture patterns and best practices

请记录：
- 并行执行情况
- 信息来源覆盖度
- 研究深度
- 综合报告质量
EOF

echo "测试输入已准备，等待手动执行..."
echo ""

# 测试 3: architecture-debate 模板
echo "💬 测试 3/3: architecture-debate 模板"
echo "-------------------------------------------------------------------"
echo "目标: 讨论团队内存共享策略"
echo "预期策略: debate (3 perspectives, 3 rounds)"
echo ""

cat > /tmp/quick-team-test-3.txt << 'EOF'
使用 quick_team 工具测试 architecture-debate 模板：

请讨论以下架构决策：
"Should team members share memory context during execution in a multi-agent system?"

考虑因素：
1. 性能影响
2. 上下文一致性
3. 实现复杂度
4. 实际应用场景

template: architecture-debate
goal: Decide whether team members should share memory context during execution
max_rounds: 3

请记录：
- 辩论轮数
- 观点差异
- 共识达成过程
- 最终决策质量
EOF

echo "测试输入已准备，等待手动执行..."
echo ""

echo "==================================================================="
echo "测试准备完成！"
echo "==================================================================="
echo ""
echo "由于需要实际调用 quick_team 工具，请手动执行以下测试："
echo ""
echo "1. 阅读 /tmp/quick-team-test-1.txt 并执行 code-review 测试"
echo "2. 阅读 /tmp/quick-team-test-2.txt 并执行 research 测试"
echo "3. 阅读 /tmp/quick-team-test-3.txt 并执行 architecture-debate 测试"
echo ""
echo "每个测试完成后，请记录以下数据："
echo "  - 总执行时间"
echo "  - 各成员执行时间"
echo "  - Token 使用量（输入/输出）"
echo "  - 执行轮数"
echo "  - 是否成功"
echo "  - 发现的问题"
echo ""

# 创建结果模板
cat > "$OUTPUT_DIR/results-template.md" << 'EOF'
# QuickTeamTool 测试结果

## 测试 1: code-review 模板

### 配置
- Template: code-review
- Goal: Review src/core/tools/QuickTeamTool.ts
- Strategy: sequential

### 执行数据
- 总执行时间: ___秒
- Token 使用: ___ input / ___ output
- 执行轮数: ___
- 成员数量: 3
- 是否成功: ___

### 成员执行详情
| 成员 | 执行时间 | Token 使用 | 状态 |
|------|---------|-----------|------|
| Architecture Reviewer | ___s | ___ tokens | ___ |
| Security Reviewer | ___s | ___ tokens | ___ |
| Performance Reviewer | ___s | ___ tokens | ___ |

### 发现的问题
1. 
2. 
3. 

### 评估
- 团队配置合理性: ___/10
- 输出质量: ___/10
- 执行效率: ___/10

---

## 测试 2: research 模板

### 配置
- Template: research
- Goal: Research TypeScript multi-agent architecture
- Strategy: parallel

### 执行数据
- 总执行时间: ___秒
- Token 使用: ___ input / ___ output
- 执行轮数: ___
- 成员数量: 3
- 是否成功: ___

### 成员执行详情
| 成员 | 执行时间 | Token 使用 | 状态 |
|------|---------|-----------|------|
| Documentation Researcher | ___s | ___ tokens | ___ |
| Code Example Analyst | ___s | ___ tokens | ___ |
| Community Practice Researcher | ___s | ___ tokens | ___ |

### 研究发现
1. 
2. 
3. 

### 评估
- 信息覆盖度: ___/10
- 研究深度: ___/10
- 并行效率: ___/10

---

## 测试 3: architecture-debate 模板

### 配置
- Template: architecture-debate
- Goal: Decide on memory sharing strategy
- Strategy: debate
- Max Rounds: 3

### 执行数据
- 总执行时间: ___秒
- Token 使用: ___ input / ___ output
- 执行轮数: ___
- 成员数量: 3
- 是否成功: ___

### 成员执行详情
| 成员 | 执行时间 | Token 使用 | 状态 |
|------|---------|-----------|------|
| Simplicity Advocate | ___s | ___ tokens | ___ |
| Scalability Advocate | ___s | ___ tokens | ___ |
| Pragmatic Advocate | ___s | ___ tokens | ___ |

### 辩论过程
- Round 1: 
- Round 2: 
- Round 3: 
- 最终共识: 

### 评估
- 观点多样性: ___/10
- 辩论质量: ___/10
- 决策合理性: ___/10

---

## 总体评估

### 性能对比
| 模板 | 执行时间 | Token 使用 | 成功率 |
|------|---------|-----------|--------|
| code-review | ___s | ___ | ___ |
| research | ___s | ___ | ___ |
| architecture-debate | ___s | ___ | ___ |

### 发现的问题
1. 
2. 
3. 

### 建议改进
1. 
2. 
3. 

### 结论
EOF

echo "结果模板已创建: $OUTPUT_DIR/results-template.md"
echo ""
