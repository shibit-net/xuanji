# 璇玑执行协议

本目录包含主 agent 在执行特定操作时**必须遵循**的协议规范。

## 协议列表

### 1. Agent Team 执行协议
**文件**: `agent-team-protocol.md`

**用途**: 主 agent 在调用 `agent_team` 工具时的强制性操作规范

**核心内容**:
- 执行前强制检查清单（任务适配性、策略选择、成员配置）
- 标准化配置模板（代码分析、技术选型、模块化分析）
- 常见错误与避免方法
- 执行流程（6 步标准流程）
- 性能基准与降级策略

**何时使用**: 
- 用户要求使用 agent_team
- 任务可拆分为 3+ 个独立子任务
- 需要多领域专家协作

### 2. Agent Team 策略手册
**文件**: `agent-team-strategies.md`

**用途**: 详细说明 5 种执行策略的使用方法和最佳实践

**核心内容**:
- **parallel（并行）**: 最快，适用于独立任务
- **debate（辩论）**: 技术选型、方案对比
- **pipeline（流水线）**: 数据处理、ETL 流程
- **sequential（顺序）**: 有依赖关系的任务
- **hierarchical（层级）**: 主从协作（谨慎使用）

**何时使用**:
- 需要选择合适的策略时
- 不确定哪种策略最优时
- 需要参考标准模板时

---

## 协议使用方式

### 方式 1: 集成到系统 Prompt（推荐）

在主 agent 的系统 prompt 中引用协议：

```
# Agent Team 使用规范

在调用 agent_team 工具前，必须遵循 `.xuanji/protocols/agent-team-protocol.md` 中的执行协议：

1. 完成强制检查清单
2. 选择合适的策略（优先 parallel）
3. 使用标准化模板配置成员
4. 设置合理的超时时间
5. 执行后根据结果决定是否需要汇总
```

### 方式 2: 运行时读取

主 agent 在需要时读取协议文件：

```typescript
// 伪代码
if (user_requests_agent_team) {
  protocol = read_file(".xuanji/protocols/agent-team-protocol.md")
  follow_protocol(protocol)
  execute_agent_team()
}
```

### 方式 3: 预处理检查

在工具执行前进行自动检查：

```typescript
// 伪代码
before_tool_execution("agent_team", (params) => {
  check_task_suitability(params.goal)
  validate_strategy(params.strategy)
  validate_members(params.members)
  estimate_timeout(params)
})
```

---

## 协议更新日志

### 2024-01-XX
- 创建 `agent-team-protocol.md`
- 定义强制检查清单
- 提供 3 个标准化模板
- 添加常见错误与避免方法

---

## 贡献指南

如果发现协议中的问题或需要补充：

1. 记录实际执行中遇到的问题
2. 分析问题原因（任务拆分不当？超时设置不合理？）
3. 更新协议文档
4. 在更新日志中记录变更

---

## 相关文档

- **用户指南**: `.xuanji/agent-team-guide.md` - 面向用户的使用指引
- **执行协议**: `.xuanji/protocols/agent-team-protocol.md` - 面向 agent 的执行规范
