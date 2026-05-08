// ============================================================
// MilkdownEditor — 共享 Markdown 编辑器/预览组件
// ============================================================
//
// 两种模式：
//   wysiwyg  — 所见即所得编辑（配置页使用）
//   preview  — 只读预览（对话框使用）
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { indent } from '@milkdown/kit/plugin/indent';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { math } from '@milkdown/plugin-math';
import { diagram } from '@milkdown/plugin-diagram';

import { remarkSubAgentReference } from '../utils/remarkSubAgentReference';
import { subAgentReferenceNode, citationReferenceNode } from './milkdown/SubAgentNodes';

import 'katex/dist/katex.min.css';

interface MilkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  mode: 'wysiwyg' | 'preview';
  height?: string;
}

/** 代码块复制按钮 — 用 React portal 渲染到每个 <pre> 上 */
function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      onClick={handleCopy}
      variant="ghost"
      size="icon"
      className="absolute top-2 right-2 h-7 w-7 bg-bg-tertiary/80 opacity-0 group-hover:opacity-100"
      title="复制代码"
    >
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-text-secondary" />}
    </Button>
  );
}

/** 给容器内所有 <pre> 代码块注入复制按钮 */
function useCodeBlockCopyButtons(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const roots: Array<ReturnType<typeof createRoot>> = [];

    function attachButtons() {
      // 清理旧的 React root
      roots.forEach((r) => r.unmount());
      roots.length = 0;

      const pres = container.querySelectorAll('pre');
      pres.forEach((pre) => {
        // 已有按钮就跳过
        if (pre.querySelector('.code-copy-btn-anchor')) return;

        const code = pre.querySelector('code');
        const codeText = code?.textContent || '';

        // 给 pre 加 relative + group 定位
        pre.classList.add('relative', 'group');

        const anchor = document.createElement('span');
        anchor.className = 'code-copy-btn-anchor';
        anchor.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;';
        pre.appendChild(anchor);

        const root = createRoot(anchor);
        root.render(<CodeCopyButton code={codeText} />);
        roots.push(root);
      });
    }

    // 初始挂载
    const timer = setTimeout(attachButtons, 200);

    // 监听 DOM 变化（流式输出时动态新增代码块）
    const observer = new MutationObserver(() => {
      attachButtons();
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      roots.forEach((r) => r.unmount());
    };
  }, [active, containerRef]);
}

/** 预览模式下用 MutationObserver 监听 diagram 节点并渲染为 SVG */
function useRenderMermaid(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;

    async function renderAllDiagrams() {
      if (cancelled) return;
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          look: 'neo',
          themeVariables: {
            primaryColor: '#2a2a4a',
            primaryBorderColor: '#6c6cf0',
            primaryTextColor: '#e0e0ff',
            lineColor: '#8888ff',
            secondaryColor: '#1e1e3a',
            tertiaryColor: '#16162e',
            mainBkg: '#1e1e3a',
            nodeBorder: '#6c6cf0',
            clusterBkg: '#16162e',
            clusterBorder: '#4444aa',
            titleColor: '#ccccff',
            edgeLabelBackground: '#1a1a3a',
            nodeTextColor: '#e0e0ff',
          },
        });
        const diagrams = container.querySelectorAll<HTMLElement>('div[data-type="diagram"]');
        for (const el of diagrams) {
          if (cancelled) return;
          // 已经有兄弟 SVG 了，跳过
          const nextSibling = el.nextElementSibling;
          if (nextSibling && nextSibling.matches('.mermaid-rendered-svg')) continue;
          // 或者用 el 本身的标记防止 ProseMirror 恢复后重复渲染
          if (el.dataset.mermaidRendered === 'true') continue;

          const code = el.dataset.value || el.textContent || '';
          if (!code.trim()) continue;
          const id = el.dataset.id || `mermaid-${Math.random().toString(36).slice(2, 8)}`;
          const { svg } = await mermaid.render(id, code);

          // 用 wrapper 包裹 SVG
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-rendered-svg';
          wrapper.innerHTML = svg;
          // 先隐藏，等 viewBox 裁剪后再显示
          wrapper.style.visibility = 'hidden';

          // 插入到 DOM
          el.after(wrapper);
          el.style.display = 'none';

          const svgEl = wrapper.querySelector('svg')!;

          // 裁剪 viewBox 到实际内容区域（用 requestAnimationFrame 确保 layout 完成）
          requestAnimationFrame(() => {
            try {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              // 遍历所有实际图形元素（rect / ellipse / path / text / polygon），忽略 defs/style/marker
              svgEl.querySelectorAll('rect, ellipse, path, text, polygon, circle, line, polyline').forEach((el) => {
                try {
                  const b = (el as SVGGraphicsElement).getBBox();
                  if (b.width > 0 && b.height > 0) {
                    if (b.x < minX) minX = b.x;
                    if (b.y < minY) minY = b.y;
                    if (b.x + b.width > maxX) maxX = b.x + b.width;
                    if (b.y + b.height > maxY) maxY = b.y + b.height;
                  }
                } catch {}
              });
              if (minX !== Infinity) {
                const p = 10;
                svgEl.setAttribute('viewBox', `${Math.max(0, minX - p)} ${Math.max(0, minY - p)} ${maxX - minX + p * 2} ${maxY - minY + p * 2}`);
              }
            } catch {}
            // viewBox 设置完成后显示
            wrapper.style.visibility = '';
          });

          // 检查是否有实际内容
          const hasContent = (
            (svgEl?.querySelector('.entityLayer')?.children?.length ?? 0) > 0 ||
            (svgEl?.querySelector('.relationshipLayer')?.children?.length ?? 0) > 0 ||
            svgEl.querySelector('[class*="node"]') ||
            svgEl.querySelector('[class*="cluster"]')
          );
          if (!hasContent) {
            wrapper.style.display = 'none';
          } else {
            wrapper.addEventListener('click', () => {
              showMermaidPreview(code, svg);
            });
          }
          // 标记已渲染，防止 ProseMirror 恢复后重复渲染
          el.dataset.mermaidRendered = 'true';
        }
      } catch (err) {
        console.error('[Mermaid] render error:', err);
      }
    }

    // 初始渲染，如果 diagram 节点还没出现则 500ms 后再试一次
    renderAllDiagrams();
    const retryTimer = setTimeout(() => {
      if (!cancelled) renderAllDiagrams();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [active, containerRef]);
}

/** 全屏预览 Mermaid 图 — 支持滚轮缩放 + 智能文件名下载 */
function showMermaidPreview(code: string, svgHtml: string) {
  const overlay = document.createElement('div');
  overlay.className = 'mermaid-preview-overlay';
  document.body.appendChild(overlay);

  // 用 backdrop 做点击关闭
  const backdrop = document.createElement('div');
  backdrop.className = 'mermaid-preview-backdrop';
  overlay.appendChild(backdrop);

  const content = document.createElement('div');
  content.className = 'mermaid-preview-content';
  overlay.appendChild(content);

  // 从 code 提取有意义的文件名
  function getContentFilename(code: string): string {
    // 优先取 %% title: 注释
    const titleMatch = code.match(/%%\s*title\s*:\s*(.+)/i);
    if (titleMatch) return titleMatch[1].trim().replace(/[^\w\u4e00-\u9fff_-]/g, '_');
    // 其次取第一个实体名
    const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('%%') || line.startsWith('erDiagram') || line.startsWith('flowchart') || line.startsWith('graph')) continue;
      const match = line.match(/^(\w+)/);
      if (match) return match[1];
    }
    const firstContent = lines.find(l => !l.startsWith('%%'));
    if (firstContent) return firstContent.replace(/[^\w\u4e00-\u9fff_-]/g, '_').slice(0, 30);
    return 'diagram';
  }
  const baseName = getContentFilename(code);
  const filename = `${baseName}.svg`;

  // header
  const header = document.createElement('div');
  header.className = 'mermaid-preview-header';
  header.innerHTML = `<span class="mermaid-preview-title">${baseName}</span>`;
  const actions = document.createElement('div');
  actions.className = 'mermaid-preview-actions';
  const zoomInfo = document.createElement('span');
  zoomInfo.className = 'mermaid-preview-zoom-info';
  zoomInfo.textContent = '100%';
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'mermaid-preview-btn';
  downloadBtn.textContent = `⬇ ${filename}`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'mermaid-preview-btn';
  closeBtn.textContent = '✕';
  actions.append(zoomInfo, downloadBtn, closeBtn);
  header.appendChild(actions);
  content.appendChild(header);

  // body — 用 template 解析 SVG
  const body = document.createElement('div');
  body.className = 'mermaid-preview-body';
  const template = document.createElement('template');
  template.innerHTML = svgHtml.trim();
  const svgNode = template.content.firstElementChild;
  if (svgNode) {
    body.appendChild(svgNode.cloneNode(true));
  } else {
    body.textContent = '[图表加载失败]';
  }
  content.appendChild(body);

  // 缩放 + 平移状态
  let scale = 1;
  let translateX = 0, translateY = 0;
  const MIN_SCALE = 0.25, MAX_SCALE = 10;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragTransX = 0, dragTransY = 0;

  function updateTransform() {
    const svg = body.querySelector('svg');
    if (!svg) return;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    zoomInfo.textContent = `${Math.round(scale * 100)}%`;
  }

  // 鼠标拖拽平移
  body.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragTransX = translateX;
    dragTransY = translateY;
    body.setPointerCapture(e.pointerId);
    body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  body.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    translateX = dragTransX + (e.clientX - dragStartX);
    translateY = dragTransY + (e.clientY - dragStartY);
    updateTransform();
  });
  body.addEventListener('pointerup', () => {
    if (isDragging) {
      isDragging = false;
      body.style.cursor = '';
    }
  });

  // 滚轮缩放（以鼠标位置为锚点）
  body.addEventListener('wheel', (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = body.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dir = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + dir));
    const ratio = newScale / scale;
    translateX = mx - ratio * (mx - translateX);
    translateY = my - ratio * (my - translateY);
    scale = newScale;
    updateTransform();
  }, { passive: false });

  // 快捷键缩放
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      scale = Math.min(MAX_SCALE, scale + 0.25);
      updateTransform();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      scale = Math.max(MIN_SCALE, scale - 0.25);
      updateTransform();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      scale = 1; translateX = 0; translateY = 0;
      updateTransform();
    }
  };
  document.addEventListener('keydown', keyHandler);

  // 关闭
  const close = () => {
    document.removeEventListener('keydown', keyHandler);
    overlay.remove();
  };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  // 下载
  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([svgHtml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function MilkdownEditorInner({ value, onChange, mode }: Omit<MilkdownEditorProps, 'height'>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleChange = useCallback(
    (markdown: string) => {
      onChange?.(markdown);
    },
    [onChange],
  );

  const editorFactory = useMemo(
    () => (container: HTMLElement) => {
      const editor = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, container);
          ctx.set(defaultValueCtx, value);
          if (mode === 'preview') {
            ctx.set(editorViewOptionsCtx, { editable: () => false });
          }
          ctx.get(listenerCtx).markdownUpdated(async (_ctx, markdown) => {
            if (mode === 'wysiwyg') {
              handleChange(markdown);
            }
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(listener);

      if (mode === 'wysiwyg') {
        editor.use(clipboard).use(history).use(cursor).use(indent);
      }

      editor.use(math).use(diagram);

      editor.use(subAgentReferenceNode);
      editor.use(citationReferenceNode);
      editor.use(remarkSubAgentReference);

      return editor;
    },
    [mode, value],
  );

  useEditor(editorFactory, [mode, value]);

  // 预览模式下给代码块注入复制按钮
  useCodeBlockCopyButtons(containerRef, mode === 'preview');
  // 预览模式下渲染 Mermaid 图表
  useRenderMermaid(containerRef, mode === 'preview');

  return (
    <div ref={containerRef}>
      <Milkdown />
    </div>
  );
}

export default function MilkdownEditor({ height, ...props }: MilkdownEditorProps) {
  return (
    <div
      className="milkdown-editor-wrapper"
      style={height ? { height, overflow: 'auto' } : undefined}
    >
      <MilkdownProvider>
        <MilkdownEditorInner {...props} />
      </MilkdownProvider>
    </div>
  );
}
