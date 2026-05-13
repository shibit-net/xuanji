/**
 * UserInputNode — 用户输入气泡（轻量、临时、自动消失）。
 */

import { Handle, Position, type NodeProps } from 'reactflow';
import type { UserInputNodeData } from '../../utils/flow/FlowNodeTypes';

export function UserInputNode({ data }: NodeProps<UserInputNodeData>) {
  return (
    <div
      className="relative rounded-2xl px-3 py-2 shadow-glass-sm flex items-center"
      style={{
        width: 200,
        height: 60,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        transition: 'opacity 0.3s ease-out',
      }}
    >
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />

      {/* 用户图标 */}
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mr-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/60">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>

      {/* 消息内容 */}
      <div className="flex-1 min-w-0">
        <span className="text-[9px] text-muted-foreground/50 block leading-none mb-0.5">用户输入</span>
        <p className="text-[11px] text-foreground/70 truncate leading-tight">
          {data.content}
        </p>
      </div>
    </div>
  );
}
