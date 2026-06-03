// ============================================================
// MessageBubble - 消息气泡组件
// ============================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Copy, Check, FileText, Image as ImageIcon, X, Maximize2, Minimize2, Music, Video } from 'lucide-react';
import { t } from '@/core/i18n';
import { marked } from 'marked';
import type { Message } from '../stores/chatStore';
import type { ContentBlock } from '../stores/messageStore';
import type { SubAgentReference } from '../stores/CitationStore';
import { useCitationStore } from '../stores/CitationStore';
import { useAuthStore } from '../stores/authStore';
import { useAgentStateMachine } from '../stores/AgentStateMachine';
import { useConfigStore } from '../stores/configStore';
import MilkdownEditor from './MilkdownEditor';
import { Avatar } from './Avatar';
import { isFilePath, toNativePath } from '../utils/pathUtils';

// 主 agent 头像
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';

function useRealtimeClock(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// 配置 marked：异步解析关闭，确保同步调用
marked.setOptions({ async: false });

/** rAF 节流的流式 markdown 渲染 hook — 上限 60fps，跳过相同长度文本避免父组件重渲染误触发 */
function useStreamingMarkdown(text: string, active: boolean): string {
  const [html, setHtml] = useState('');
  const rafRef = useRef(0);
  const lastTextLen = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (text.length === lastTextLen.current) return;
    lastTextLen.current = text.length;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      try {
        setHtml(marked.parse(text, { breaks: true, async: false }) as string);
      } catch {
        setHtml(text);
      }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, active]);

  return html;
}

function getAgentDisplay(agentId: string | undefined): { name: string; agentId: string } {
  if (!agentId || agentId === 'xuanji') return { name: 'Xuanji', agentId: 'xuanji' };
  const a = useAgentStateMachine.getState().agentMap[agentId];
  if (a) return { name: a.name, agentId: a.id };
  return { name: agentId, agentId };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTokens(tokens: { input: number; output: number }, showBreakdown = false): string {
  const total = tokens.input + tokens.output;
  const totalStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
  if (showBreakdown) {
    const inputStr = tokens.input >= 1000 ? `${(tokens.input / 1000).toFixed(1)}k` : `${tokens.input}`;
    const outputStr = tokens.output >= 1000 ? `${(tokens.output / 1000).toFixed(1)}k` : `${tokens.output}`;
    return `${totalStr} tokens (↑${inputStr} ↓${outputStr})`;
  }
  return `${totalStr} tokens`;
}

/** 将普通文本中的换行转为 Markdown 硬换行（两个空格 + 换行），代码块内保留 */
function normalizeLineBreaks(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/\n/g, '  \n');
    })
    .join('');
}

function normalizeMarkdownHeadings(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/([^\n#])(#{2,6})\s/g, '$1\n\n$2 ');
    })
    .join('');
}

/** 确保 markdown 表格后有空行，防止 remark-gfm 将后续文本误解析为表格行 */
function normalizeTableBreaks(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/^(\s*\|[^\n]*)\n(?!\s*$)(?!\s*\|)/gm, '$1\n\n');
    })
    .join('');
}

/** 移除 markdown 中的原始 HTML 标签（<details>/<summary> 等），代码块内保留 */
function stripRawHtml(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/<\/?details>/gi, '')
        .replace(/<summary>(.*?)<\/summary>/gi, '**$1**\n')
        .replace(/<\/?summary>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(div|span|section|article)[^>]*>/gi, '');
    })
    .join('');
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  streamingText?: string;
}

/** 文档图标 — 用于 toolSummary、SubAgentBlock、CitationChip */
function FileIcon({ size = 14, className, simple }: { size?: number; className?: string; simple?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {!simple && (<><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>)}
    </svg>
  );
}

/** 解码 base64 SVG 为文本，内联渲染避免 <img>/<object> 的安全限制 */
function decodeSvgText(data: string): string {
  try {
    return atob(data);
  } catch {
    return '';
  }
}

/** 图片内容块 — 支持点击放大，Lightbox 通过 Portal 渲染到 body */
function ImageBlock({ block }: { block: Extract<ContentBlock, { type: 'image' }> }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const src = block.data
    ? `data:${block.mimeType};base64,${block.data}`
    : block.imageUrl || '';
  const isSvg = block.mimeType === 'image/svg+xml';
  const svgText = isSvg && block.data ? decodeSvgText(block.data) : '';

  useEffect(() => {
    if (isSvg) {
      // 从 SVG viewBox 提取宽高比，没有则默认 4:3
      const vbMatch = svgText.match(/viewBox=["']([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (vbMatch) {
        setAspect(parseFloat(vbMatch[3]) / parseFloat(vbMatch[4]));
      } else {
        const wMatch = svgText.match(/width=["'](\d+)/);
        const hMatch = svgText.match(/height=["'](\d+)/);
        if (wMatch && hMatch) {
          setAspect(parseFloat(wMatch[1]) / parseFloat(hMatch[1]));
        } else {
          setAspect(4 / 3);
        }
      }
      setLoaded(true);
      return;
    }
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth / img.naturalHeight);
    img.onerror = () => setAspect(1);
    img.src = src;
  }, [src, isSvg, svgText]);

  const paddingBottom = aspect ? `${(1 / aspect) * 100}%` : '25%';

  return (
    <>
      <div className="my-2 rounded-xl overflow-hidden border border-border bg-muted cursor-pointer
                      hover:border-primary/50 transition-all duration-200 group relative"
           onClick={() => setExpanded(true)}
           style={{ maxHeight: '400px' }}>
        <div style={{ paddingBottom, position: 'relative', minHeight: '100px' }}>
          {isSvg ? (
            <div
              className="absolute inset-0 w-full h-full flex items-center justify-center p-2"
              dangerouslySetInnerHTML={{ __html: svgText }}
            />
          ) : (
            <img
              src={src}
              alt="截图"
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setLoaded(true)}
            />
          )}
        </div>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity
                        bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1">
          <Maximize2 size={12} className="text-white/70" />
          <span className="text-[10px] text-white/70">点击放大</span>
        </div>
      </div>

      {expanded && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center
                     animate-fadeIn cursor-zoom-out"
          onClick={() => setExpanded(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
            onClick={() => setExpanded(false)}
          >
            <X size={20} className="text-white" />
          </button>
          {isSvg ? (
            <div
              className="max-w-[95vw] max-h-[95vh] rounded-lg shadow-2xl bg-white/5 p-4"
              dangerouslySetInnerHTML={{ __html: svgText }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={src}
              alt={t('msg.image_alt_zoomed')}
              className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>,
        document.body
      )}
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const IMAGE_FILE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);

function FileBlock({ block }: { block: Extract<ContentBlock, { type: 'file' }> }) {
  const ext = block.fileName.slice(block.fileName.lastIndexOf('.')).toLowerCase();
  const isImageFile = IMAGE_FILE_EXTS.has(ext);

  return (
    <div
      className="my-2 rounded-xl border border-border bg-muted hover:bg-secondary hover:border-primary/50 transition-all duration-200 overflow-hidden cursor-pointer"
      onClick={() => {
        if (block.filePath) {
          window.electron?.openFile(block.filePath);
        }
      }}
      title={`点击打开: ${block.fileName}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 文件图标 */}
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          {isImageFile ? (
            <ImageIcon size={20} className="text-blue-400" />
          ) : (
            <FileText size={20} className="text-muted-foreground" />
          )}
        </div>
        {/* 文件信息 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground truncate">{block.fileName}</div>
          <div className="text-[11px] text-muted-foreground/80 mt-0.5">
            {block.fileSize ? formatFileSize(block.fileSize) : ''}
            {block.fileSize ? ' · ' : ''}点击打开
          </div>
        </div>
        {/* 右侧箭头 */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/70 flex-shrink-0">
          <path d="M7 17l9.2-9.2M17 17V7H7" />
        </svg>
      </div>
    </div>
  );
}

/** 音频内容块 — 用原生 <audio> 标签播放 */
function AudioBlock({ block }: { block: Extract<ContentBlock, { type: 'audio' }> }) {
  const src = block.data
    ? `data:${block.mimeType || 'audio/mpeg'};base64,${block.data}`
    : (block as any).imageUrl || '';
  if (!src) return null;
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-border bg-muted">
      <audio controls className="w-full h-12" preload="metadata">
        <source src={src} type={block.mimeType || 'audio/mpeg'} />
      </audio>
      <div className="px-3 pb-2 text-[11px] text-muted-foreground/80 flex items-center gap-2">
        <Music size={12} />
        <span>{block.name || (block.mimeType || 'audio').replace('audio/', '')}</span>
        {block.duration ? <span>· {Math.round(block.duration)}s</span> : null}
      </div>
    </div>
  );
}

/** 视频内容块 — 用原生 <video> 标签播放 */
function VideoBlock({ block }: { block: Extract<ContentBlock, { type: 'video' }> }) {
  const src = block.data
    ? `data:${block.mimeType || 'video/mp4'};base64,${block.data}`
    : block.url || (block as any).imageUrl || '';
  if (!src) return null;
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-border bg-muted">
      <video controls className="w-full max-h-[400px]" preload="metadata">
        <source src={src} type={block.mimeType || 'video/mp4'} />
      </video>
      <div className="px-3 pb-2 text-[11px] text-muted-foreground/80 flex items-center gap-2">
        <Video size={12} />
        <span>{block.name || (block.mimeType || 'video').replace('video/', '')}</span>
      </div>
    </div>
  );
}

/** 渲染 ContentBlock 列表（text / image / file / audio / video） */
function ContentBlocksRenderer({ blocks, processedContent, isStreaming, containerRef }: {
  blocks: ContentBlock[];
  processedContent: string;
  isStreaming: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const textBlocks = blocks.filter(b => b.type === 'text');
  const imageBlocks = blocks.filter(b => b.type === 'image');
  const fileBlocks = blocks.filter(b => b.type === 'file');
  const audioBlocks = blocks.filter(b => b.type === 'audio');
  const videoBlocks = blocks.filter(b => b.type === 'video');
  // 合并所有 text 块的文本
  const combinedText = textBlocks.map(b => (b as { type: 'text'; text: string }).text).join('\n');

  return (
    <>
      {/* 文本块 */}
      {combinedText && (
        <div ref={containerRef} className="milkdown-message-content">
          {isStreaming ? (
            <div className="text-sm markdown-streaming-body" dangerouslySetInnerHTML={{ __html: processedContent }} />
          ) : (
            <MilkdownEditor value={processedContent} mode="preview" />
          )}
        </div>
      )}
      {/* 图片块 */}
      {imageBlocks.map((block, i) => (
        <ImageBlock key={`img-${i}`} block={block as Extract<ContentBlock, { type: 'image' }>} />
      ))}
      {/* 文件块 */}
      {fileBlocks.map((block, i) => (
        <FileBlock key={`file-${i}`} block={block as Extract<ContentBlock, { type: 'file' }>} />
      ))}
      {/* 音频块 */}
      {audioBlocks.map((block, i) => (
        <AudioBlock key={`audio-${i}`} block={block as Extract<ContentBlock, { type: 'audio' }>} />
      ))}
      {/* 视频块 */}
      {videoBlocks.map((block, i) => (
        <VideoBlock key={`video-${i}`} block={block as Extract<ContentBlock, { type: 'video' }>} />
      ))}
    </>
  );
}

const MessageBubble = React.memo(function MessageBubble({ message, isStreaming = false, streamingText }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isToolSummary = message.toolSummary === true;
  const containerRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const userName = user?.nickname || user?.email?.split('@')[0] || 'You';
  const agentInfo = useMemo(() => !isUser && !isToolSummary ? getAgentDisplay(message.agentId) : null, [message.agentId, isUser, isToolSummary]);
  // 流式消息：优先用 streamingAgentId（当前实际输出文本的 agent），其次 foregroundId
  const foregroundId = useAgentStateMachine((s) => s.foregroundAgentId);
  const streamingAgentId = useAgentStateMachine((s) => s.streamingAgentId);
  const effectiveAgentId = isStreaming ? (streamingAgentId || foregroundId || message.agentId) : message.agentId;
  const respondingAgent = useAgentStateMachine((s) => effectiveAgentId ? s.agentMap[effectiveAgentId] : undefined);
  const showTokenUsage = useConfigStore((s) => s.settings.showTokenUsage);
  const showThinking = useConfigStore((s) => s.settings.showThinking);
  const now = useRealtimeClock(isStreaming);

  const displayContent = isStreaming && streamingText !== undefined ? streamingText : message.content;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = typeof displayContent === 'string' ? displayContent : '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayContent]);

  const streamingHtml = useStreamingMarkdown(typeof displayContent === 'string' ? displayContent : '', isStreaming);
  const processedContent = useMemo(() => {
    if (typeof displayContent !== 'string') return '';
    let text = normalizeLineBreaks(normalizeTableBreaks(normalizeMarkdownHeadings(stripRawHtml(displayContent))));

    // 解析 LLM 输出的本地图片路径 → base64 data URI
    // 从工具调用中获取 ReadTool 返回的 contentBlocks（含 base64 图片数据）
    const tools = respondingAgent?.currentTools;
    if (tools && tools.length > 0) {
      // 构建 filePath → data URI 映射
      const imageMap = new Map<string, string>();
      for (const tc of tools) {
        const filePath = tc.input?.path as string | undefined;
        if (filePath && tc.contentBlocks) {
          for (const block of tc.contentBlocks) {
            if (block.type === 'image') {
              imageMap.set(filePath, `data:${block.mimeType};base64,${block.data}`);
            }
          }
        }
      }
      // 替换 Markdown 图片语法中的本地路径
      if (imageMap.size > 0) {
        text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, path) => {
          // 精确路径匹配
          for (const [filePath, dataUri] of imageMap) {
            if (path === filePath || filePath === path) return `![${alt}](${dataUri})`;
          }
          // 文件名匹配（处理 LLM 用相对路径或仅文件名的情况）
          const pathBasename = path.split('/').pop();
          if (pathBasename) {
            for (const [filePath, dataUri] of imageMap) {
              if (filePath.split('/').pop() === pathBasename) return `![${alt}](${dataUri})`;
            }
          }
          return match;
        });
      }
    }

    return text;
  }, [displayContent, respondingAgent?.currentTools]);

  // 实时耗时：流式时从 message.timestamp 实时计算，完成后用 message.duration
  const liveDuration = useMemo(() => {
    if (message.duration) return message.duration;
    if (message.timestamp) return now - message.timestamp;
    return undefined;
  }, [message.duration, message.timestamp, now]);

  // 将 Milkdown 渲染出的自定义节点（subagent-ref / citation-ref span）替换为可交互组件
  // 流式过程中跳过：此时用 marked 渲染，没有 SubAgentRef span 需要替换
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isUser || isSystem) return;
    if (isStreaming) return;

    const roots: Array<ReturnType<typeof createRoot>> = [];
    let enhanced = false;

    function enhance() {
      if (enhanced) return;
      // 检查容器是否仍在 DOM 中
      if (!container || !document.contains(container)) return;

      roots.forEach((r) => queueMicrotask(() => r.unmount()));
      roots.length = 0;

      // 按文档顺序精确匹配：第 n 次出现的 name 取 citationOutputs[name] 的第 n 项
      const nameCounts: Record<string, number> = {};

      // 处理子 Agent 块引用
      const subagentSpans = container.querySelectorAll('span[data-type="subagent-ref"]');
      if (subagentSpans.length > 0) {
        enhanced = true;
        subagentSpans.forEach((el) => {
          const span = el as HTMLSpanElement;
          const name = span.dataset.name || '';
          const index = nameCounts[name] || 0;
          nameCounts[name] = index + 1;

          const state = useCitationStore.getState();
          const list = state.citations[name];
          const citation = list && list.length > index ? list[index] : (list && list.length > 0 ? list[list.length - 1] : null);

          const anchor = document.createElement('span');
          anchor.style.cssText = 'display:inline;';
          span.replaceWith(anchor);
          const root = createRoot(anchor);
          root.render(<SubAgentBlock name={name} citation={citation} />);
          roots.push(root);
        });
      }

      // 处理引用语法（同名引用同理按顺序匹配）
      const citationSpans = container.querySelectorAll('span[data-type="citation-ref"]');
      if (citationSpans.length > 0) {
        enhanced = true;
        const citationCounts: Record<string, number> = {};
        citationSpans.forEach((el) => {
          const span = el as HTMLSpanElement;
          const name = span.dataset.name || '';
          const quote = span.dataset.quote || '';
          const index = citationCounts[name] || 0;
          citationCounts[name] = index + 1;

          const state = useCitationStore.getState();
          const list = state.citations[name];
          const citation = list && list.length > index ? list[index] : (list && list.length > 0 ? list[list.length - 1] : null);

          const anchor = document.createElement('span');
          anchor.style.cssText = 'display:inline;';
          span.replaceWith(anchor);
          const root = createRoot(anchor);
          root.render(<CitationChip name={name} quote={quote} citation={citation} />);
          roots.push(root);
        });
      }

      // 处理 diff 代码块着色（查找所有代码块，根据内容判断是否为 diff）
      container.querySelectorAll('pre code').forEach((el) => {
        const code = el as HTMLElement;
        if (code.dataset.diffEnhanced) return;
        const html = code.innerHTML;
        // 检查是否包含 diff 格式的行（+/-/@@ 开头）
        const textLines = html.replace(/<[^>]*>/g, '').trim().split('\n').filter(Boolean);
        const isDiff = textLines.some(l => l.trim().match(/^[+-]/) || l.trim().match(/^@@/));
        if (!isDiff) return;
        code.dataset.diffEnhanced = 'true';
        const codeLines = html.split(/\n|<br\s*\/?>/gi).filter(Boolean);
        const enhanced2 = codeLines.map((line) => {
          const text = line.replace(/<[^>]*>/g, '').trim();
          const lineStyle = (() => {
            if (text.startsWith('+')) return 'color:#4ade80;background:rgba(74,222,128,0.08);';
            if (text.startsWith('-')) return 'color:#f87171;background:rgba(248,113,113,0.08);';
            if (text.startsWith('@@')) return 'color:#94a3b8;';
            return '';
          })();
          return `<div style="display:block;${lineStyle}padding:0 4px;border-radius:2px;min-height:1.5em;">${line}</div>`;
        }).join('\n');
        code.innerHTML = enhanced2;
      });

      // 处理 toolSummary 消息中的文件路径 code 元素 — 标记为可点击，CSS 负责样式
      container.querySelectorAll('code').forEach((el) => {
        const code = el as HTMLElement;
        if (code.dataset.fileLinked || code.closest('pre')) return;
        const text = code.textContent?.trim() || '';
        if (!isFilePath(text)) return;
        const displayPath = toNativePath(text);
        code.dataset.fileLinked = text;
        code.className = 'tool-summary-filepath';
        const iconSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        code.innerHTML = `${iconSvg} ${displayPath}`;
      });
    }

    // 2 级重试，确保 Milkdown 渲染完成后替换引用标签
    const retryDelays = [150, 500];
    const timers: ReturnType<typeof setTimeout>[] = [];

    function scheduleRetry(delay: number) {
      const timer = setTimeout(() => {
        if (enhanced || !container || !document.contains(container)) return;
        const hasSpans = container.querySelector('span[data-type="subagent-ref"], span[data-type="citation-ref"]');
        if (hasSpans) enhance();
      }, delay);
      timers.push(timer);
    }

    retryDelays.forEach(scheduleRetry);

    // MutationObserver：Milkdown 异步渲染完成后自动触发，仅观察至 enhance 完成
    let observerRaf = 0;
    const observer = new MutationObserver(() => {
      if (enhanced) return;
      cancelAnimationFrame(observerRaf);
      observerRaf = requestAnimationFrame(() => {
        if (!enhanced) enhance();
      });
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(observerRaf);
      observer.disconnect();
      roots.forEach((r) => queueMicrotask(() => r.unmount()));
    };
  }, [processedContent, isUser, isSystem, isStreaming]);

  if (isSystem) {
    return (
      <div className={`flex justify-center my-4${isStreaming ? '' : ' animate-fadeIn'}`}>
        <div className="max-w-[80%] bg-muted/30 border border-primary/30 rounded-lg p-3 text-sm text-muted-foreground text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}${isStreaming ? '' : ' animate-fadeIn'}`}>
      <div className="flex flex-col max-w-[80%] min-w-0">
      <div
        className={`message-bubble ${
          isStreaming ? 'message-bubble-streaming' : ''
        } ${
          isUser
            ? 'bg-primary text-white'
            : isToolSummary
              ? 'bg-muted border border-border backdrop-blur-sm text-foreground'
              : 'bg-secondary text-foreground'
        } rounded-xl p-4 shadow-lg ${
          isStreaming ? 'overflow-hidden' : 'overflow-y-auto max-h-[60vh]'
        }`}
        onClick={(e) => {
          // 事件委托：处理文件路径 code 点击
          const target = e.target as HTMLElement;
          const filePathEl = target.closest('[data-file-linked]');
          if (filePathEl) {
            const path = filePathEl.getAttribute('data-file-linked');
            if (path) {
              e.preventDefault();
              e.stopPropagation();
              window.electron.openFile(path);
              return;
            }
          }
          // 事件委托：处理普通链接点击（用系统浏览器打开）
          const linkEl = target.closest('a');
          if (linkEl && linkEl.href && !linkEl.dataset.fileLinked) {
            const href = linkEl.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              e.preventDefault();
              e.stopPropagation();
              // 通过 Electron IPC 调用 shell.openExternal 打开系统默认浏览器
              window.electron.openUrl(href);
            }
          }
        }}
      >
        {/* 消息头部 */}
        <div className="flex items-center gap-2 mb-2">
          {isUser ? (
            user?.avatar ? (
              <img src={user.avatar} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
            ) : (
              <Avatar seed={user?.email || user?.nickname || 'user'} size={20} className="w-5 h-5 rounded-full" />
            )
          ) : isToolSummary ? (
            <FileIcon size={16} className="text-blue-400 flex-shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
              {!effectiveAgentId || effectiveAgentId === 'xuanji' ? (
                <img src={agentAvatar} alt="Xuanji" className="w-full h-full object-cover" />
              ) : (
                <Avatar seed={respondingAgent?.name || agentInfo?.name || effectiveAgentId} size={20} className="w-full h-full rounded-full" />
              )}
            </div>
          )}
          <span className={`text-sm font-semibold ${isToolSummary ? 'text-muted-foreground' : ''}`}>
            {isUser
              ? userName
              : isToolSummary
              ? t('msg.file_changes')
              : (respondingAgent?.name || agentInfo?.name || 'Xuanji')}
          </span>
          {message.timestamp && (
            <span className="text-xs opacity-60 ml-auto">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* 复制按钮 — 非流式消息显示 */}
          {!isStreaming && typeof displayContent === 'string' && displayContent.length > 0 && (
            <button
              onClick={handleCopy}
              className="ml-1 p-1 rounded-md hover:bg-accent transition-colors flex-shrink-0"
              title={t('msg.copy')}
            >
              {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} className="text-muted-foreground/80 hover:text-muted-foreground" />}
            </button>
          )}
        </div>

        {/* 用户消息附件标签 */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.attachments.map((att, i) => (
              <span
                key={`${att.name}-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/20 text-[11px] text-white/90"
              >
                <FileText size={10} className="flex-shrink-0" />
                <span className="max-w-[140px] truncate">{att.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Moment 状态条 — 流式输出时始终展示 */}
        {showThinking && isStreaming && !isUser && !isSystem && !isToolSummary && (
          respondingAgent?.moment &&
          (respondingAgent.status === 'thinking' || respondingAgent.status === 'executing' ||
           respondingAgent.status === 'writing' || respondingAgent.status === 'reporting') ? (
            <div className="flex items-center gap-2 mb-2 px-1 min-h-[24px]">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                respondingAgent.status === 'thinking' || respondingAgent.status === 'executing'
                  ? 'bg-primary animate-pulse'
                  : 'bg-blue-400'
              }`} />
              <span className="text-[11px] text-muted-foreground/70">
                {respondingAgent.status === 'writing'
                  ? `${respondingAgent.name} 在编辑中`
                  : respondingAgent.moment.label}
              </span>
              {respondingAgent.moment.startTime ? (
                <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
                  {formatDuration(now - respondingAgent.moment.startTime)}
                </span>
              ) : respondingAgent.moment.duration != null ? (
                <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
                  {formatDuration(respondingAgent.moment.duration)}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2 px-1 min-h-[24px]">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-primary animate-pulse" />
              <span className="text-[11px] text-muted-foreground/70">
                {agentInfo?.name || 'Xuanji'} 回复中
              </span>
            </div>
          )
        )}

        {!isUser && message.statusHint && (
          <div className="mb-2 text-xs text-muted-foreground animate-pulse">{message.statusHint}</div>
        )}

        {/* 消息内容 — 流式时纯文本渲染，完成后 Milkdown 渲染 */}
        <div ref={containerRef} className={`max-w-none ${isUser ? 'text-white' : 'text-foreground'} milkdown-message-content`}>
          {/* 图片块 — 渲染在文本上方（LLM 回复中通常用"上图"指代），跳过已在 markdown 中内联的图片 */}
          {message.contentBlocks?.filter(b => b.type === 'image').filter(block => {
            const imgBlock = block as Extract<ContentBlock, { type: 'image' }>;
            const dataUri = `data:${imgBlock.mimeType};base64,${imgBlock.data}`;
            return !processedContent.includes(dataUri);
          }).map((block, i) => (
            <ImageBlock key={`img-${i}`} block={block as Extract<ContentBlock, { type: 'image' }>} />
          ))}
          {message.contentBlocks?.filter(b => b.type === 'file').map((block, i) => (
            <FileBlock key={`file-${i}`} block={block as Extract<ContentBlock, { type: 'file' }>} />
          ))}
          {/* 音频块 */}
          {message.contentBlocks?.filter(b => b.type === 'audio').map((block, i) => (
            <AudioBlock key={`audio-${i}`} block={block as Extract<ContentBlock, { type: 'audio' }>} />
          ))}
          {/* 视频块 */}
          {message.contentBlocks?.filter(b => b.type === 'video').map((block, i) => (
            <VideoBlock key={`video-${i}`} block={block as Extract<ContentBlock, { type: 'video' }>} />
          ))}
          {typeof displayContent === 'string' && displayContent.length > 0 ? (
            isStreaming ? (
              <div className="text-sm markdown-streaming-body" dangerouslySetInnerHTML={{ __html: streamingHtml }} />
            ) : (
              <MilkdownEditor value={processedContent} mode="preview" />
            )
          ) : !displayContent && (
            <div className="text-sm">[复杂内容]</div>
          )}
        </div>

      </div>

        {/* 耗时 & Token — 气泡外部下方，流式时实时更新；toolSummary 不展示耗时（独立 diff 气泡无需计时） */}
        {!isUser && !isSystem && !isToolSummary && (liveDuration || message.tokensUsed) && (
          <div className={`flex items-center gap-2.5 mt-1.5 px-2 text-[11px] font-mono ${
            isToolSummary ? 'text-muted-foreground/60' : 'text-muted-foreground/50'
          }`}>
            {liveDuration && (
              <span className="inline-flex items-center gap-1">
                <span className={`opacity-50 ${isStreaming ? 'animate-pulse' : ''}`}>⏱</span>
                {formatDuration(liveDuration)}
              </span>
            )}
            {liveDuration && showTokenUsage && message.tokensUsed && (
              <span className="opacity-30">·</span>
            )}
            {showTokenUsage && message.tokensUsed && (
              <span>{formatTokens(message.tokensUsed, true)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** 子 Agent 块引用 — 点击弹出 Modal 展示子 agent 详细输出 */
function SubAgentBlock({ name, citation }: { name: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-flex">
      <button
        onClick={() => citation && setExpanded(true)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg whitespace-nowrap
                   bg-muted border border-border
                   text-xs text-blue-400
                   transition-all duration-200
                   ${citation ? 'hover:bg-secondary hover:border-primary/50 cursor-pointer' : 'cursor-default opacity-50'}`}
      >
        <FileIcon size={12} className="flex-shrink-0" />
        <span className="font-medium truncate max-w-[120px]">{name}</span>
        {citation && <ChevronDown size={11} className="text-muted-foreground/80" />}
      </button>

      {/* Modal — Portal 到 body */}
      {expanded && citation && createPortal(
        <div
          className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm flex items-center justify-center
                     animate-fadeIn cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] m-6 bg-background border border-border rounded-2xl shadow-2xl
                       flex flex-col overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <FileIcon size={16} className="text-blue-400 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 mt-0.5">
                    <span>⏱ {((citation.duration ?? 0) / 1000).toFixed(1)}s</span>
                    <span>●</span>
                    <span>{(citation.tokensUsed?.input ?? 0) + (citation.tokensUsed?.output ?? 0)} tokens</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto p-5 flex-1">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed break-words">
                {citation.originalOutput || citation.summary || t('msg.no_output')}
              </pre>
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

/** 引用语法 — 点击弹出 Modal 查看完整输出 */
function CitationChip({ name, quote, citation }: { name: string; quote: string; citation: SubAgentReference | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline text-sm leading-relaxed">
      {citation ? (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg whitespace-nowrap mr-1
                     bg-muted hover:bg-secondary
                     border border-border hover:border-primary/50
                     text-xs text-blue-400
                     transition-all duration-200 cursor-pointer"
        >
          <FileIcon size={11} simple className="flex-shrink-0" />
          <span className="font-medium">{name}</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-muted text-muted-foreground/80 text-xs cursor-default border border-border whitespace-nowrap mr-1">
          <FileIcon size={11} simple className="flex-shrink-0" />
          <span>{name}</span>
        </span>
      )}
      <span className="text-muted-foreground">：{quote}</span>

      {/* Modal — Portal 到 body */}
      {expanded && citation && createPortal(
        <div
          className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm flex items-center justify-center
                     animate-fadeIn cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] m-6 bg-background border border-border rounded-2xl shadow-2xl
                       flex flex-col overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <FileIcon size={16} className="text-blue-400 flex-shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 mt-0.5">
                    <span>⏱ {((citation.duration ?? 0) / 1000).toFixed(1)}s</span>
                    <span>●</span>
                    <span>{(citation.tokensUsed?.input ?? 0) + (citation.tokensUsed?.output ?? 0)} tokens</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto p-5 flex-1">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed break-words">
                {citation.originalOutput || citation.summary || t('msg.no_output')}
              </pre>
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

export default MessageBubble;
