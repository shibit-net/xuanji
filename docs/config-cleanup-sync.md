# Prompt 和 Agent 配置清理与同步总结

## 清理的文件

### 用户目录（.xuanji/users/）
- ❌ `177164660076560204/prompts/base-identity.yaml` - 已改为 l0-base-identity.yaml
- ❌ `177164660076560204/prompts/base-task-execution.yaml` - 已改为 l0-base-task-execution.yaml
- ❌ `cli-user/prompts/l1-explain.yaml` - 不是核心场景
- ❌ `cli-user/prompts/l1-life.yaml` - 不属于软件开发范畴

### 模板目录（src/core/templates/）
- ❌ `prompts/l1-explain.yaml` - 不是核心场景
- ❌ `prompts/l1-life.yaml` - 不属于软件开发范畴

## 同步到模板目录的文件

### 新增的 L1 场景（8个）
1. ✅ `l1-deploy.yaml` - 部署配置场景
2. ✅ `l1-monitor.yaml` - 监控运维场景
3. ✅ `l1-requirement.yaml` - 需求分析场景
4. ✅ `l1-user-research.yaml` - 用户研究场景
5. ✅ `l1-product-plan.yaml` - 产品规划场景
6. ✅ `l1-interaction.yaml` - 交互设计场景
7. ✅ `l1-ui-design.yaml` - UI设计场景
8. ✅ `l1-design-system.yaml` - 设计系统场景

### 新增的应用级 Agent（3个）
1. ✅ `software-engineer.yaml` - Code Architect
2. ✅ `product-manager.yaml` - Product Strategist
3. ✅ `ui-designer.yaml` - Design Wizard

## 当前配置状态

### 模板目录（src/core/templates/）

#### Agents（6个）
- xuanji.yaml - 主 Agent
- scene-classifier.yaml - 场景分类器
- intent-analyzer.yaml - 意图分析器
- software-engineer.yaml - 软件工程师 ✨
- product-manager.yaml - 产品经理 ✨
- ui-designer.yaml - UI设计师 ✨

#### Prompts - L1 场景（15个）

**Software Engineer 场景（9个）**
1. l1-explore.yaml - 代码探索
2. l1-plan.yaml - 架构设计
3. l1-write-code.yaml - 代码编写
4. l1-debug.yaml - 代码调试
5. l1-test.yaml - 测试编写
6. l1-refactor.yaml - 代码重构
7. l1-review.yaml - 代码审查
8. l1-deploy.yaml - 部署配置 ✨
9. l1-monitor.yaml - 监控运维 ✨

**Product Manager 场景（3个）**
10. l1-requirement.yaml - 需求分析 ✨
11. l1-user-research.yaml - 用户研究 ✨
12. l1-product-plan.yaml - 产品规划 ✨

**UI Designer 场景（3个）**
13. l1-interaction.yaml - 交互设计 ✨
14. l1-ui-design.yaml - UI设计 ✨
15. l1-design-system.yaml - 设计系统 ✨

### 用户目录（.xuanji/users/177164660076560204/）

#### Agents（5个）
- xuanji.yaml - 主 Agent
- scene-classifier.yaml - 场景分类器
- software-engineer.yaml - 软件工程师
- product-manager.yaml - 产品经理
- ui-designer.yaml - UI设计师

#### Prompts（22个）
- **L0 层**：4个（base-identity, base-task-execution, base-memory-guide, safety）
- **L1 层**：15个（与模板目录一致）
- **L2 层**：3个（agent-rules, planning, team-coordination）
- **L3 层**：动态生成

## 验证

### 检查重复
```bash
# 检查是否还有重复的场景
find . -name "l1-coding.yaml" -o -name "l1-explain.yaml" -o -name "l1-life.yaml"
# 结果：无重复文件
```

### 统计
```bash
# 模板目录中的 L1 场景数量
ls -1 src/core/templates/prompts/l1-*.yaml | wc -l
# 结果：15

# 模板目录中的 Agent 数量
ls -1 src/core/templates/agents/*.yaml | wc -l
# 结果：6

# 用户目录中的 L1 场景数量
ls -1 .xuanji/users/177164660076560204/prompts/l1-*.yaml | wc -l
# 结果：15

# 用户目录中的 Agent 数量
ls -1 .xuanji/users/177164660076560204/agents/*.yaml | wc -l
# 结果：5
```

## 结论

✅ **所有配置已清理完成**
- 删除了重复和不需要的场景文件
- 删除了旧的 prompt 文件

✅ **所有配置已同步到模板目录**
- 8 个新场景已同步
- 3 个应用级 Agent 已同步

✅ **配置结构清晰**
- 15 个 L1 场景，覆盖软件开发全流程
- 3 个应用级 Agent，职责明确
- 无重复文件

---

**清理日期**：2026-04-23  
**同步日期**：2026-04-23  
**状态**：✅ 完成
