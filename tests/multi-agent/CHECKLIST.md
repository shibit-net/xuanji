# PipelineTool 测试执行清单

## 快速开始

```bash
# 1. 进入项目目录
cd /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji

# 2. 运行 CLI 集成测试（推荐）
./tests/multi-agent/run-pipeline-tests.sh

# 3. 查看结果
cat tests/multi-agent/pipeline-results/EXECUTION_REPORT.md
```

---

## 测试清单

### ✅ 已完成

- [x] 设计 5 个核心测试场景
- [x] 创建 TypeScript 完整测试套件（607行）
- [x] 创建 ESM 测试计划生成器（684行）
- [x] 创建 Bash CLI 集成测试（243行）
- [x] 创建监控脚本（56行）
- [x] 生成测试计划文档
- [x] 生成测试摘要报告
- [x] 设置输出目录结构

### ⏳ 待执行

- [ ] 运行 CLI 集成测试
- [ ] 收集执行结果
- [ ] 分析数据流正确性
- [ ] 验证错误处理机制
- [ ] 测量性能指标
- [ ] 生成执行报告
- [ ] 记录发现的问题
- [ ] 提出改进建议

---

## 测试场景

### 1️⃣ 简单 2 步流水线
- **目标:** 基本数据流
- **步骤:** coder → coder
- **验证:** {{previous_output}} 替换

### 2️⃣ 数据转换流水线
- **目标:** 多步数据处理
- **步骤:** explore → coder → coder
- **验证:** 数据在 3 步间正确传递

### 3️⃣ 变量替换
- **目标:** 模板机制测试
- **步骤:** coder → coder → coder
- **验证:** 标记在所有步骤中累积

### 4️⃣ 混合 Agent 类型
- **目标:** Agent 协作
- **步骤:** explore → coder
- **验证:** 只读/可写权限正确

---

## 文件清单

### 测试脚本
- `tests/multi-agent/pipeline-tool-test.ts` - 完整测试（TypeScript）⚠️ 导入问题
- `tests/multi-agent/pipeline-tool-simple.mjs` - 测试计划生成器 ✅
- `tests/multi-agent/run-pipeline-tests.sh` - CLI 集成测试 ⏳
- `tests/multi-agent/monitor-pipeline-test.sh` - 监控脚本 ✅

### 文档输出
- `tests/multi-agent/pipeline-results/PIPELINE_TEST_PLAN.md` - 详细测试计划 ✅
- `tests/multi-agent/PIPELINE_TEST_SUMMARY.md` - 测试摘要 ✅
- `tests/multi-agent/pipeline-results/EXECUTION_REPORT.md` - 执行报告 ⏳

### 测试数据（运行时生成）
- `tests/multi-agent/pipeline-results/test-data.json`
- `tests/multi-agent/pipeline-results/raw-data.json`
- `tests/multi-agent/pipeline-results/sample-code.js`

### 测试输出（运行时生成）
- `tests/multi-agent/pipeline-results/Simple-2-Step.txt`
- `tests/multi-agent/pipeline-results/Data-Transform.txt`
- `tests/multi-agent/pipeline-results/Variable-Substitution.txt`
- `tests/multi-agent/pipeline-results/Mixed-Agents.txt`

---

## 验证标准

### ✅ 数据流测试通过条件
```javascript
// 最终输出应包含所有步骤的数据
final_output.includes(step1_data) === true
final_output.includes(step2_data) === true
final_output.includes(stepN_data) === true
```

### ✅ 变量替换测试通过条件
```javascript
// 不应有字面量模板字符串
final_output.includes('{{previous_output}}') === false
// 应包含所有标记
final_output.includes('STEP_1') === true
final_output.includes('STEP_2') === true
```

### ✅ 错误处理测试通过条件
```javascript
// 应在失败步骤停止
status === 'failed'
completedSteps === 1
failedStep === 2
errorMessage.length > 0
```

---

## 性能基准

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 2步流水线 | < 60s | 计时器 |
| 4步流水线 | < 5min | 计时器 |
| 单步平均 | < 30s | 总时长/步数 |
| 内存增量 | < 500MB | memoryUsage() |

---

## 故障排查

### 问题 1: 测试脚本无法执行
```bash
# 检查权限
ls -l tests/multi-agent/*.sh
# 如果没有执行权限
chmod +x tests/multi-agent/*.sh
```

### 问题 2: CLI 无法找到
```bash
# 检查构建
npm run build
# 检查 dist 目录
ls -l dist/index.js
```

### 问题 3: 测试超时
```bash
# 增加 timeout（在 run-pipeline-tests.sh 中）
timeout 300 ./dist/index.js  # 改为 300s
```

### 问题 4: 输出目录不存在
```bash
# 手动创建
mkdir -p tests/multi-agent/pipeline-results
```

---

## 成功标准

**测试套件通过条件:**

1. ✅ 所有 4 个测试场景执行完成
2. ✅ 至少 3/4 测试返回预期结果
3. ✅ 数据流在所有成功测试中验证
4. ✅ 错误处理测试正确捕获失败
5. ✅ 无超时或资源泄漏
6. ✅ 生成完整的执行报告

**质量门槛:**
- 成功率 >= 75%
- 平均执行时间 < 90s
- 无崩溃或挂起

---

## 报告结构

执行完成后，生成的 `EXECUTION_REPORT.md` 应包含：

1. **执行摘要**
   - 测试数量
   - 成功/失败数
   - 总执行时间

2. **详细结果**
   - 每个测试的状态
   - 输出文件位置
   - 错误信息（如有）

3. **性能数据**
   - 各测试执行时间
   - 资源使用情况

4. **关键发现**
   - 数据流验证结果
   - 错误处理观察
   - Agent 协作情况

5. **建议**
   - 改进点
   - 后续测试需求

---

## 下一步

### 1. 立即执行
```bash
./tests/multi-agent/run-pipeline-tests.sh
```

### 2. 等待完成（约 5-10 分钟）

### 3. 查看结果
```bash
# 执行报告
cat tests/multi-agent/pipeline-results/EXECUTION_REPORT.md

# 各测试输出
ls -lh tests/multi-agent/pipeline-results/*.txt

# 测试数据
cat tests/multi-agent/pipeline-results/*.json
```

### 4. 分析并记录
- 数据流是否完整？
- 错误处理是否正确？
- 性能是否满足要求？
- 有无意外行为？

---

## 联系信息

**测试负责:** Coder Agent (Sub-Agent)  
**测试类型:** PipelineTool 功能验证  
**优先级:** 高  
**状态:** 基础设施完成，待执行

---

*最后更新: 2024-03-24*  
*测试版本: v1.0*  
*文档位置: tests/multi-agent/CHECKLIST.md*
