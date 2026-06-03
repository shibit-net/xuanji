// ============================================================
// ProjectFileTree - 嵌入侧栏的项目文件树（纯树形内容）
// 从 ProjectFilesPanel 提取核心渲染逻辑，去掉面板 chrome
// ============================================================

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { ChevronRight, ChevronDown, RefreshCw, ExternalLink, Copy, FolderOpen, Folder, File, FileCode, FileText, FileJson, FileCog, Terminal, Globe } from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';

interface FileEntry {
  name: string; path: string; isDirectory: boolean; size: number; modifiedAt: number;
}
interface TreeNode {
  entry: FileEntry; depth: number; expanded: boolean; children?: TreeNode[]; loading?: boolean;
}

// ============================================================
// git 状态
// ============================================================

const GIT_COLORS: Record<string, string> = {
  M: 'text-amber-400', A: 'text-emerald-400', D: 'text-red-400', '?': 'text-blue-400',
};

function gitColor(code: string): string | null {
  if (!code) return null;
  const k = code[0] === '?' ? '?' : code[0];
  return GIT_COLORS[k] || null;
}

// ============================================================
// 图标 & 格式化
// ============================================================

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const cls = 'w-3 h-3';
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'py': case 'go': case 'rs': case 'java': return <FileCode size={10} className={cls} />;
    case 'json': return <FileJson size={10} className={cls} />;
    case 'md': return <FileText size={10} className={cls} />;
    case 'html': case 'vue': return <Globe size={10} className={cls} />;
    case 'yml': case 'yaml': return <FileCog size={10} className={cls} />;
    case 'sh': return <Terminal size={10} className={cls} />;
    case 'css': return <FileCode size={10} className={`${cls} text-purple-400`} />;
    default: return <File size={10} className={cls} />;
  }
}

function fmtSize(b: number): string {
  if (!b) return '';
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

// ============================================================
// TreeItem（递归）
// ============================================================

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.cache']);

function TreeItem({ node, onToggle, onOpenFile, onContextMenu, gitStatus, rootRelPath }: {
  node: TreeNode; onToggle: (n: TreeNode) => void; onOpenFile: (p: string) => void;
  onContextMenu: (e: React.MouseEvent, n: TreeNode) => void;
  gitStatus: Record<string, string>; rootRelPath: (p: string) => string;
}) {
  const { entry, depth, expanded, children, loading } = node;
  const isDir = entry.isDirectory;
  if (IGNORE_DIRS.has(entry.name) && depth > 0) return null;

  const gColor = gitColor(gitStatus[rootRelPath(entry.path)]);

  return (
    <div>
      <div
        className="flex items-center gap-0.5 px-1 py-0.5 rounded cursor-pointer hover:bg-muted/30 transition-colors text-xs group"
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => (isDir ? onToggle(node) : onOpenFile(entry.path))}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
        title={entry.path}
      >
        {isDir ? (
          <span className="w-3 flex items-center justify-center flex-shrink-0 text-muted-foreground/40">
            {loading ? <RefreshCw size={9} className="animate-spin" /> : expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </span>
        ) : <span className="w-3" />}

        {gColor ? (
          <span className={`text-[7px] w-1.5 text-center flex-shrink-0 ${gColor}`}>●</span>
        ) : <span className="w-1.5" />}

        <span className="flex-shrink-0 text-[10px] w-3 text-center">
          {isDir ? (expanded ? <FolderOpen size={10} className="w-3 h-3 text-muted-foreground/50" /> : <Folder size={10} className="w-3 h-3 text-muted-foreground/50" />) : <FileIcon name={entry.name} />}
        </span>

        <span className="truncate min-w-0 ml-0.5 text-foreground/60 group-hover:text-foreground transition-colors text-[11px]">
          {entry.name}
        </span>
      </div>

      {isDir && expanded && children && (
        <div>
          {children.length > 0
            ? children.map(c => <TreeItem key={c.entry.path} node={c} onToggle={onToggle} onOpenFile={onOpenFile} onContextMenu={onContextMenu} gitStatus={gitStatus} rootRelPath={rootRelPath} />)
            : <div className="text-[9px] text-muted-foreground/30 italic pl-8 py-0.5">{getDesktopLabel('filetree.empty_dir', language)}</div>}
        </div>
      )}
    </div>
  );
}

function updateNode(nodes: TreeNode[], targetPath: string, updates: Partial<Pick<TreeNode, 'expanded' | 'loading' | 'children'>>): TreeNode[] {
  return nodes.map(n => {
    if (n.entry.path === targetPath) return { ...n, ...updates };
    if (n.children) return { ...n, children: updateNode(n.children, targetPath, updates) };
    return n;
  });
}

// ============================================================
// 主组件
// ============================================================

function ProjectFileTree({ onGitBranchChange }: { onGitBranchChange?: (branch: string | null) => void }) {
  const language = useConfigStore((s) => s.settings.language);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const notifyGitBranch = (b: string | null) => { setGitBranch(b); onGitBranchChange?.(b); };
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [blankCtxMenu, setBlankCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const rootRelPath = useCallback((p: string) => rootPath ? p.replace(rootPath, '').replace(/^\//, '') : p, [rootPath]);

  const loadGitStatus = useCallback(async (dir: string) => {
    try { const r = await window.electron.workspaceGetGitStatus(dir); if (r.success && r.status) setGitStatus(r.status); } catch {}
  }, []);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await window.electron.workspaceReadDirectory();
      if (r.success && r.items) {
        setRootPath(r.currentPath || '');
        notifyGitBranch((r as any).gitBranch || null);
        setTreeData((r.items ?? []).map(i => ({ entry: i, depth: 0, expanded: false })));
        if (r.currentPath) {
          loadGitStatus(r.currentPath);
          window.electron.workspaceStartWatch?.(r.currentPath);
        }
      } else {
        setError(r.error || '无法读取目录');
      }
    } catch (e: any) {
      setError(e.message || '读取目录失败');
    }
    setLoading(false);
  }, [loadGitStatus]);

  useEffect(() => {
    loadRoot();
    return () => { window.electron.workspaceStopWatch?.(); };
  }, [loadRoot]);

  useEffect(() => {
    const refresh = (data: { path: string }) => {
      window.electron.workspaceReadDirectory(data.path).then(r => {
        if (!r.success || !r.items) return;
        setRootPath(r.currentPath || '');
        notifyGitBranch((r as any).gitBranch || null);
        setTreeData((r.items ?? []).map(i => ({ entry: i, depth: 0, expanded: false })));
        setError('');
        if (r.currentPath) loadGitStatus(r.currentPath);
      });
    };

    window.electron.onWorkspaceDirectoryChanged(refresh);
    window.electron.on?.('agent:tool-end', (data: any) => {
      if (data.name === 'change_directory' && !data.isError && data.metadata?.path) {
        refresh({ path: data.metadata.path });
      }
    });

    // 窗口获得焦点时自动刷新
    const onFocus = () => { if (rootPath) refresh({ path: rootPath }); };
    window.addEventListener('focus', onFocus);

    // 定期轮询（每 5 秒检测文件变更）
    const pollInterval = setInterval(() => {
      if (rootPath && document.hasFocus()) {
        refresh({ path: rootPath });
      }
    }, 5000);

    return () => {
      window.electron.offWorkspaceDirectoryChanged(refresh);
      window.electron.off?.('agent:tool-end', refresh);
      window.removeEventListener('focus', onFocus);
      clearInterval(pollInterval);
    };
  }, [loadGitStatus, rootPath]);

  const handleToggle = useCallback(async (node: TreeNode) => {
    if (node.expanded) {
      setTreeData(p => updateNode(p, node.entry.path, { expanded: false, children: undefined }));
      return;
    }
    if (!node.children && !node.loading) {
      setTreeData(p => updateNode(p, node.entry.path, { loading: true }));
      try {
        const r = await window.electron.workspaceReadDirectory(node.entry.path);
        if (r.success && r.items) {
          setTreeData(p => updateNode(p, node.entry.path, { expanded: true, loading: false, children: (r.items ?? []).map(i => ({ entry: i, depth: node.depth + 1, expanded: false })) }));
        } else {
          setTreeData(p => updateNode(p, node.entry.path, { loading: false }));
        }
      } catch {
        setTreeData(p => updateNode(p, node.entry.path, { loading: false }));
      }
    } else {
      setTreeData(p => updateNode(p, node.entry.path, { expanded: true }));
    }
  }, []);

  const handleOpenFile = useCallback(async (fp: string) => { try { await window.electron.workspaceOpenFile(fp); } catch {} }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  useEffect(() => {
    const close = () => { setCtxMenu(null); setBlankCtxMenu(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleShowInFolder = useCallback(async () => {
    if (!ctxMenu) return;
    await window.electron.workspaceShowInFolder(ctxMenu.node.entry.path);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleCopyPath = useCallback(async () => {
    if (!ctxMenu) return;
    await navigator.clipboard.writeText(ctxMenu.node.entry.path);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleOpenInSystem = useCallback(async () => {
    if (!ctxMenu) return;
    await window.electron.workspaceOpenFile(ctxMenu.node.entry.path);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleBlankContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setBlankCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRefresh = useCallback(() => {
    setBlankCtxMenu(null);
    loadRoot();
  }, [loadRoot]);

  return (
    <div className="min-h-0 overflow-y-auto overflow-x-hidden px-1 py-1" onContextMenu={handleBlankContextMenu}>
      {loading && (
        <div className="flex items-center justify-center py-4">
          <RefreshCw size={12} className="animate-spin text-muted-foreground/30" />
        </div>
      )}
      {error && <div className="p-2 text-[10px] text-destructive/80">{error}</div>}
      {!loading && !error && treeData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-4">
          <FolderOpen size={14} className="text-muted-foreground/30 mb-1" />
          <p className="text-[10px] text-muted-foreground/40">{getDesktopLabel('filetree.empty_dir', language)}</p>
        </div>
      )}
      {!loading && !error && treeData.map(n => (
        <TreeItem key={n.entry.path} node={n} onToggle={handleToggle} onOpenFile={handleOpenFile} onContextMenu={handleContextMenu} gitStatus={gitStatus} rootRelPath={rootRelPath} />
      ))}

      {/* 文件/文件夹右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-card rounded-xl shadow-glass-lg py-1 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {!ctxMenu.node.entry.isDirectory && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
              onClick={handleOpenInSystem}
            >
              <ExternalLink size={11} className="text-muted-foreground" />
              {getDesktopLabel('filetree.open_file', language)}
            </button>
          )}
          {ctxMenu.node.entry.isDirectory && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
              onClick={handleOpenInSystem}
            >
              <ExternalLink size={11} className="text-muted-foreground" />
              {getDesktopLabel('filetree.open_folder', language)}
            </button>
          )}
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
            onClick={handleShowInFolder}
          >
            <FolderOpen size={11} className="text-muted-foreground" />
            {getDesktopLabel('filetree.show_in_folder', language)}
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
            onClick={handleCopyPath}
          >
            <Copy size={11} className="text-muted-foreground" />
            {getDesktopLabel('filetree.copy_path', language)}
          </button>
        </div>
      )}

      {/* 空白区域右键菜单 */}
      {blankCtxMenu && (
        <div
          className="fixed z-50 bg-card rounded-xl shadow-glass-lg py-1 min-w-[120px]"
          style={{ left: blankCtxMenu.x, top: blankCtxMenu.y }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
            onClick={handleRefresh}
          >
            <RefreshCw size={11} className="text-muted-foreground" />
            {getDesktopLabel('filetree.refresh', language)}
          </button>
          {rootPath && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-muted transition-colors"
              onClick={async () => { await window.electron.workspaceShowInFolder(rootPath); setBlankCtxMenu(null); }}
            >
              <FolderOpen size={11} className="text-muted-foreground" />
              {getDesktopLabel('filetree.show_in_folder', language)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ProjectFileTree);
