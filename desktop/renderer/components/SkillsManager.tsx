// ============================================================
// SkillsManager - Skills 管理面板
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, X, Package, Eye, EyeOff } from 'lucide-react';
import type { SkillInfo } from '../global';

interface SkillsManagerProps {
  onClose: () => void;
}

export default function SkillsManager({ onClose }: SkillsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await window.electron.skillsList();
      if (res.success && res.skills) setSkills(res.skills);
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, searchQuery]);

  return (
    <div className="flex-1 flex flex-col bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Package size={24} className="text-primary" />
          <h2 className="text-lg font-bold">Skills</h2>
          {!loading && (
            <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">
              {filtered.length} Skills
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-bg-tertiary rounded transition-colors" title="关闭">
          <X size={20} />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="p-3 border-b border-bg-tertiary">
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="搜索 Skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-bg-tertiary rounded px-8 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-sm text-text-secondary py-8">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">没有找到匹配的 Skill</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className="bg-bg-secondary border border-bg-tertiary rounded-lg p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold">{skill.name}</h3>
                      <span className="text-xs bg-bg-tertiary px-1.5 py-0.5 rounded">{skill.type}</span>
                      {skill.enabled ? (
                        <span className="text-xs text-green-500 flex items-center gap-1"><Eye size={12} /> 已启用</span>
                      ) : (
                        <span className="text-xs text-text-secondary flex items-center gap-1"><EyeOff size={12} /> 未启用</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mb-2">{skill.description}</p>
                    <p className="text-xs text-text-tertiary font-mono">ID: {skill.id}</p>
                  </div>
                </div>
                {skill.requiredTools && skill.requiredTools.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-bg-tertiary">
                    <p className="text-xs text-text-secondary mb-1">依赖工具:</p>
                    <div className="flex gap-1 flex-wrap">
                      {skill.requiredTools.map((tool) => (
                        <span key={tool} className="text-xs bg-bg-primary px-1.5 py-0.5 rounded font-mono">{tool}</span>
                      ))}
                    </div>
                  </div>
                )}
                {skill.tags && skill.tags.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-bg-tertiary">
                    <p className="text-xs text-text-secondary mb-1">标签:</p>
                    <div className="flex gap-1 flex-wrap">
                      {skill.tags.map((tag) => (
                        <span key={tag} className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
