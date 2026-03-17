// ============================================================
// MCPManager - MCP 服务器管理面板
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, X, Server, Eye, EyeOff } from 'lucide-react';
import type { MCPServerInfo } from '../global';

interface MCPManagerProps {
  onClose: () => void;
}

export default function MCPManager({ onClose }: MCPManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await window.electron.mcpList();
      if (res.success && res.servers) setServers(res.servers);
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
    );
  }, [servers, searchQuery]);

  return (
    <div className="flex-1 flex flex-col bg-bg-primary">
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Server size={24} className="text-primary" />
          <h2 className="text-lg font-bold">MCP Servers</h2>
          {!loading && (
            <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">{filtered.length} Servers</span>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-bg-tertiary rounded transition-colors" title="关闭">
          <X size={20} />
        </button>
      </div>

      <div className="p-3 border-b border-bg-tertiary">
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索 MCP Servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-sm text-text-secondary py-8">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">没有配置 MCP 服务器</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((server) => (
              <div
                key={server.name}
                className="bg-bg-secondary border border-bg-tertiary rounded-lg p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Server size={16} className="text-primary" />
                      <h3 className="text-sm font-semibold">{server.name}</h3>
                      {server.enabled ? (
                        <span className="text-xs text-green-500 flex items-center gap-1"><Eye size={12} /> 已启用</span>
                      ) : (
                        <span className="text-xs text-text-secondary flex items-center gap-1"><EyeOff size={12} /> 未启用</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-text-secondary mb-1">命令:</p>
                        <code className="text-xs bg-bg-primary px-2 py-1 rounded font-mono block">
                          {server.command} {server.args?.join(' ')}
                        </code>
                      </div>
                      {server.env && Object.keys(server.env).length > 0 && (
                        <div>
                          <p className="text-xs text-text-secondary mb-1">环境变量:</p>
                          <div className="space-y-1">
                            {Object.entries(server.env).map(([key, value]) => (
                              <div key={key} className="text-xs font-mono">
                                <span className="text-text-tertiary">{key}=</span>
                                <span className="text-text-secondary">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(server.toolCount !== undefined || server.promptCount !== undefined) && (
                        <div>
                          <p className="text-xs text-text-secondary mb-1">统计:</p>
                          <div className="flex gap-2">
                            {server.toolCount !== undefined && (
                              <span className="text-xs bg-bg-primary px-1.5 py-0.5 rounded">{server.toolCount} 工具</span>
                            )}
                            {server.promptCount !== undefined && (
                              <span className="text-xs bg-bg-primary px-1.5 py-0.5 rounded">{server.promptCount} Prompts</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
