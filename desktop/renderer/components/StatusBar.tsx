// ============================================================
// StatusBar - 状态栏组件
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { ClipboardList } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { useConversationStore } from '../stores/ConversationStore';
import { DownloadQueue } from './DownloadQueue';
import { Badge } from '@/components/ui/badge';

export default function StatusBar() {
  const currentSkill = useConversationStore((state) => state.activeSkill);
  const isPlanMode = useSessionStore((state) => state.isPlanMode);

  // 系统资源监控
  const [resourceUsage, setResourceUsage] = useState<{
    cpuPercent: number;
    memoryMB: number;
    totalMemoryMB: number;
    percent: number;
  } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const result = await window.electron.getResourceUsage();
        if (result.success && result.data) {
          setResourceUsage({
            cpuPercent: Math.round(result.data.cpu.percentCPUUsage * 10) / 10,
            memoryMB: result.data.memory.usedMB,
            totalMemoryMB: result.data.memory.totalMB,
            percent: result.data.memory.percent,
          });
        }
      } catch (e) {
        console.warn('[StatusBar] getResourceUsage failed:', e);
      }
    };

    fetchUsage();
    intervalRef.current = setInterval(fetchUsage, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="flex-shrink-0 h-7 bg-muted/30 border-t border-border flex items-center justify-between px-4 text-[11px] text-muted-foreground/70">
      {/* 左侧：Plan Mode 徽标 + 当前 Skill */}
      <div className="flex items-center gap-4">
        {isPlanMode && (
          <Badge variant="warning" className="tracking-wide text-[10px] px-1.5 py-0.5">
            <ClipboardList size={10} className="mr-1 inline" />
            PLAN MODE
          </Badge>
        )}
        {currentSkill && (
          <div className="flex items-center gap-2">
            <span>{currentSkill.icon}</span>
            <span>{currentSkill.name}</span>
          </div>
        )}
      </div>

      {/* 右侧：系统资源 + 下载队列 */}
      <div className="flex items-center gap-3">
        {resourceUsage && (
          <>
            <span className="flex items-center gap-1" title="CPU 使用率">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              CPU {resourceUsage.cpuPercent}%
            </span>
            <span className="flex items-center gap-1" title={`内存 ${resourceUsage.memoryMB}MB / ${resourceUsage.totalMemoryMB}MB`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
              内存 {resourceUsage.percent}%
            </span>
          </>
        )}
        <DownloadQueue />
      </div>
    </div>
  );
}
