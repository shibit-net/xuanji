// ============================================================
// ExecutionWorkspace - 拟人化 Agent 监视器
// ============================================================
// 设计理念：
// - 圆形头像 + 呼吸动画 + 光晕效果
// - 柔和的渐变色和圆角
// - Agent "站在" 连线上，像真实的工作流
// - 工具像"漂浮的气泡"围绕在 Agent 周围
// ============================================================

import { useMessageStore } from '../stores/messageStore';
import { Activity } from 'lucide-react';

export default function ExecutionWorkspace() {
  const messages = useMessageStore((state) => state.messages);

  // 获取最后一条用户消息
  const lastUserMessage = messages.filter((m) => m.role === 'user').slice(-1)[0];

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
            <Activity size={20} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Agent 执行监视器</div>
            <div className="text-xs text-gray-400">等待任务...</div>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* 用户输入 */}
          {lastUserMessage && (
            <div className="relative">
              <div className="flex items-start gap-6">
                {/* 用户头像 */}
                <div className="relative flex-shrink-0">
                  <div className="w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-full flex items-center justify-center text-3xl shadow-xl border-4 border-white/10">
                    👤
                  </div>
                </div>

                {/* 消息气泡 */}
                <div className="flex-1 bg-gradient-to-r from-gray-800/50 to-gray-700/50 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-none px-6 py-4 shadow-lg">
                  <div className="text-xs text-gray-400 mb-1">用户</div>
                  <div className="text-sm text-white leading-relaxed">
                    {lastUserMessage.content.slice(0, 200)}
                    {lastUserMessage.content.length > 200 ? '...' : ''}
                  </div>
                </div>
              </div>

              {/* 连接线 */}
              <div className="ml-8 mt-4 flex items-center gap-3">
                <div className="w-0.5 h-12 bg-gradient-to-b from-gray-600 to-transparent" />
                <div className="text-xs text-gray-500">开始处理</div>
              </div>
            </div>
          )}

          {/* 空状态 */}
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="mb-6 relative inline-block">
                {/* 脉动光圈 */}
                <div className="absolute inset-0 bg-blue-500/30 rounded-full animate-ping" />
                <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-5xl shadow-2xl">
                  ✨
                </div>
              </div>
              <div className="text-xl font-bold text-white mb-2">等待执行任务...</div>
              <div className="text-sm text-gray-400">
                发送消息后，Agent 将开始工作
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="border-t border-white/10 bg-black/30 backdrop-blur-xl px-6 py-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="w-2 h-2 bg-gray-600 rounded-full" />
            <span>待命中</span>
          </div>
          <div className="text-gray-500">
            实时显示 · 拟人化交互
          </div>
        </div>
      </div>
    </div>
  );
}
