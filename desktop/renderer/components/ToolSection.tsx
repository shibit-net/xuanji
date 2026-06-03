// ============================================================
// Xuanji Desktop - 工具区域组件
// ============================================================
// 展示工具执行列表
// ============================================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolCall } from '../stores/messageStore';

interface ToolSectionProps {
  tools: ToolCall[];
}

// ============================================================
// 模块级纯函数（避免每次渲染重复创建）
// ============================================================

function getStatusIcon(status: ToolCall['status']) {
  switch (status) {
    case 'pending':
      return <Clock className="w-4 h-4 text-muted-foreground/50" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />;
    case 'success':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-red-500" />;
  }
}

function formatDuration(ms?: number) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getInputPreview(input?: Record<string, unknown>): string {
  if (!input) return '无参数';
  const keys = Object.keys(input);
  if (keys.length === 0) return '无参数';

  const preview: string[] = [];
  const importantKeys = ['file_path', 'path', 'pattern', 'command', 'content', 'name'];

  for (const key of importantKeys) {
    if (key in input) {
      const value = input[key];
      if (typeof value === 'string') {
        preview.push(`${key}: ${value}`);
        break;
      }
    }
  }

  if (preview.length === 0) {
    for (const key of keys.slice(0, 2)) {
      const value = input[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        preview.push(`${key}: ${String(value).substring(0, 30)}`);
      }
    }
  }

  return preview.join(', ') || `${keys.length} 个参数`;
}

export function ToolSection({ tools }: ToolSectionProps) {
  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* 工具头部 */}
      <div
        className="p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0">{getStatusIcon(tool.status)}</div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{tool.name}</span>
              {tool.duration && <span className="text-xs text-muted-foreground">· {formatDuration(tool.duration)}</span>}
            </div>

            {!expanded && (
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {getInputPreview(tool.input)}
              </div>
            )}
          </div>

          <div className="flex-shrink-0">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {/* 展开的详情 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-3 space-y-3">
              {/* 输入 */}
              <div>
                <div className="text-xs text-muted-foreground mb-1">输入</div>
                <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>

              {/* 输出 */}
              {tool.output && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">输出</div>
                  <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                    {tool.output}
                  </pre>
                </div>
              )}

              {/* 图片输出 */}
              {(tool as any).contentBlocks?.filter((b: any) => b.type === 'image').map((block: any, i: number) => (
                <div key={`img-${i}`}>
                  <div className="text-xs text-muted-foreground mb-1">截图</div>
                  <img
                    src={`data:${block.mimeType};base64,${block.data}`}
                    alt="工具截图"
                    className="w-full max-h-[400px] object-contain rounded-lg border border-white/[0.08]"
                  />
                </div>
              ))}

              {/* 错误 */}
              {tool.error && (
                <div>
                  <div className="text-xs text-red-500 mb-1">错误</div>
                  <pre className="text-xs bg-red-500/10 text-red-500 rounded p-2 overflow-x-auto">
                    {tool.error}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
