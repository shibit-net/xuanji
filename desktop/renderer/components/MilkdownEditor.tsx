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
import { emoji } from '@milkdown/plugin-emoji';

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
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 bg-bg-tertiary/80 hover:bg-bg-tertiary rounded opacity-0 group-hover:opacity-100 transition-opacity"
      title="复制代码"
    >
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-text-secondary" />}
    </button>
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
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            if (mode === 'wysiwyg') {
              handleChange(markdown);
            }
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(emoji)
        .use(listener);

      if (mode === 'wysiwyg') {
        editor.use(clipboard).use(history).use(cursor).use(indent);
      }

      editor.use(math).use(diagram);

      // 注册自定义子 Agent 引用节点
      editor.use(subAgentReferenceNode);
      editor.use(citationReferenceNode);

      // 注册 remark 插件（解析 📎 语法为自定义节点）
      editor.use(remarkSubAgentReference);

      return editor;
    },
    [mode, value, handleChange],
  );

  useEditor(editorFactory, [mode]);

  // 预览模式下给代码块注入复制按钮
  useCodeBlockCopyButtons(containerRef, mode === 'preview');

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
