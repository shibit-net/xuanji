// ============================================================
// ProjectFilesPanel - 项目文件面板（最右侧栏）
// 显示当前操作目录的完整文件树，不传参时从子进程获取当前 cwd
// 点击目录展开/折叠（懒加载），点击文件用系统默认程序打开
// git 管理的文件显示 git status 标记
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, ChevronRight, ChevronDown, X, RefreshCw, GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  M: '#FBBF24', A: '#34D399', D: '#F87171', '?': '#60A5FA',
};

function gitColor(code: string): string | null {
  if (!code) return null;
  const k = code[0] === '?' ? '?' : code[0];
  return GIT_COLORS[k] || null;
}

// ============================================================
// 图标 & 格式化
// ============================================================

const FILE_ICONS: Record<string, string> = {
  ts: '📘', tsx: '⚛️', js: '📒', jsx: '⚛️', json: '📋', md: '📝',
  css: '🎨', html: '🌐', yml: '⚙️', yaml: '⚙️', py: '🐍', go: '🔷',
  rs: '🦀', java: '☕', sh: '💻', vue: '💚',
};

function fileIcon(name: string): string {
  return FILE_ICONS[name.split('.').pop()?.toLowerCase() || ''] || '📄';
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

function TreeItem({ node, onToggle, onOpenFile, gitStatus, rootRelPath }: {
  node: TreeNode; onToggle: (n: TreeNode) => void; onOpenFile: (p: string) => void;
  gitStatus: Record<string, string>; rootRelPath: (p: string) => string;
}) {
  const { entry, depth, expanded, children, loading } = node;
  const isDir = entry.isDirectory;
  if (IGNORE_DIRS.has(entry.name) && depth > 0) return null;

  const gColor = gitColor(gitStatus[rootRelPath(entry.path)]);

  return (
    <div>
      <div
        className="flex items-center gap-0.5 px-1 py-0.5 rounded cursor-pointer hover:bg-white/5 transition-colors text-xs group"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDir ? onToggle(node) : onOpenFile(entry.path))}
        title={entry.path}
      >
        {isDir ? (
          <span className="w-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground/40">
            {loading ? <RefreshCw size={10} className="animate-spin" /> : expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        ) : <span className="w-3.5" />}

        {gColor ? (
          <span className="text-[8px] w-2 text-center flex-shrink-0" style={{ color: gColor }}>●</span>
        ) : <span className="w-2" />}

        <span className="flex-shrink-0 text-[11px] w-3.5 text-center">
          {isDir ? (expanded ? '📂' : '📁') : fileIcon(entry.name)}
        </span>

        <span className="truncate min-w-0 ml-1 text-foreground/70 group-hover:text-foreground transition-colors">
          {entry.name}
        </span>

        {!isDir && <span className="ml-auto text-[9px] text-muted-foreground/30 flex-shrink-0">{fmtSize(entry.size)}</span>}
      </div>

      {isDir && expanded && children && (
        <div>
          {children.length > 0
            ? children.map(c => <TreeItem key={c.entry.path} node={c} onToggle={onToggle} onOpenFile={onOpenFile} gitStatus={gitStatus} rootRelPath={rootRelPath} />)
            : <div className="text-[9px] text-muted-foreground/30 italic pl-10 py-1">空目录</div>}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export default function ProjectFilesPanel({ onToggle }: { onToggle: () => void }) {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        setGitBranch(r.gitBranch ?? null);
        setTreeData((r.items ?? []).map(i => ({ entry: i, depth: 0, expanded: false })));
        if (r.currentPath) loadGitStatus(r.currentPath);
      } else {
        setError(r.error || '无法读取目录');
      }
    } catch (e: any) {
      setError(e.message || '读取目录失败');
    }
    setLoading(false);
  }, [loadGitStatus]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  // 监听目录切换事件
  useEffect(() => {
    const refresh = (data: { path: string }) => {
      window.electron.workspaceReadDirectory(data.path).then(r => {
        if (!r.success || !r.items) return;
        setRootPath(r.currentPath || '');
        setGitBranch(r.gitBranch ?? null);
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

    return () => {
      window.electron.offWorkspaceDirectoryChanged(refresh);
      window.electron.off?.('agent:tool-end', refresh);
    };
  }, [loadGitStatus]);

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

  const dirName = rootPath.split('/').pop() || rootPath.split('\\').pop() || 'workspace';

  return (
    <div className="bg-card flex flex-col border-l border-border h-full w-full">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen size={14} className="text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-foreground/70 truncate">{dirName}</span>
          {gitBranch && (
            <span className="flex items-center gap-0.5 text-[9px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
              <GitBranch size={9} />{gitBranch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={loadRoot} className="h-6 w-6" title="刷新"><RefreshCw size={12} className="text-muted-foreground/60" /></Button>
          <Button variant="ghost" size="icon" onClick={onToggle} className="h-6 w-6" title="关闭面板"><X size={12} className="text-muted-foreground/60" /></Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw size={16} className="animate-spin text-muted-foreground/30" />
              <span className="text-[10px] text-muted-foreground/20">加载中...</span>
            </div>
          </div>
        )}
        {error && <div className="p-3 text-xs text-destructive/80">{error}</div>}
        {!loading && !error && treeData.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-card backdrop-blur-sm flex items-center justify-center mb-3">
              <FolderOpen size={18} className="text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground/40">空目录</p>
          </div>
        )}
        {!loading && !error && treeData.map(n => (
          <TreeItem key={n.entry.path} node={n} onToggle={handleToggle} onOpenFile={handleOpenFile} gitStatus={gitStatus} rootRelPath={rootRelPath} />
        ))}
      </div>

      <div className="flex-shrink-0 px-2 py-1 border-t border-border">
        <p className="text-[9px] text-muted-foreground/30 truncate" title={rootPath}>{rootPath}</p>
      </div>
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
