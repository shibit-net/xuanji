# GUI 自动重新编译测试

## 测试步骤

1. **启动 GUI**（会自动编译 CLI 代码）
   ```bash
   npm run dev:gui
   ```

2. **观察启动日志**，你应该看到：
   ```
   [CLI] Build succeeded
   [GUI] Electron 已启动
   ```

3. **在 GUI 中测试 TaskTool**，发送：
   ```
   请用 explore agent 探索 src/core/agent/ 目录
   ```

4. **观察终端日志**，应该看到我们添加的调试信息：
   ```
   [CLI] [ChatSession] Calling taskTool.setDependencies() with deps: ...
   [CLI] [TaskTool] Execute called. Dependency status: ...
   ```

5. **修改代码测试热更新**（可选）
   - 修改 `src/core/tools/TaskTool.ts` 中的任何内容
   - 保存文件
   - 观察终端：应该自动重新编译
   - Electron 会自动重启

## 预期结果

✅ TaskTool 不再报 "dependencies not injected" 错误
✅ 调试日志正常显示
✅ 修改代码后自动重新编译和重启

## 如果遇到问题

- 日志混乱？使用 `--kill-others-on-fail` 参数
- 端口占用？检查 9100 端口是否被占用
- 编译失败？检查 TypeScript 错误

