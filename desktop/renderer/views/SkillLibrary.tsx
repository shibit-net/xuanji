// ============================================================
// Xuanji Desktop - SkillLibrary 组件
// ============================================================
// 职责：
// - Skill 库视图（配置域）
// - 展示所有 Skills（核心 + 场景）
// - 支持查看详情、搜索、筛选
// - 使用 configStore 管理数据
// - 只读展示（Skills 配置由代码定义）
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { Search, X, Sparkles, Eye, EyeOff, RefreshCw, Filter } from 'lucide-react';
import { useConfigStore } from '../stores';
import type { SkillDefinition } from '../types/models';

interface SkillLibraryProps {
  onClose: () => void;
}

type FilterType = 'all' | 'prompt' | 'agent' | 'workflow';
type FilterStatus = 'all' | 'enabled' | 'disabled';

export default function SkillLibrary({ onClose }: SkillLibraryProps) {
  // ========== Store 数据 ==========
  const { skills, loading, error, loadSkills } = useConfigStore();

  // ========== 本地状态 ==========
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ========== 初始化加载 ==========
  useEffect(() => {
    loadSkills();
  }, []);

  // ========== 过滤 ==========
  const filteredSkills = useMemo(() => {
    let result = [...skills];

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (skill) =>
          skill.id?.toLowerCase().includes(query) ||
          skill.name?.toLowerCase().includes(query) ||
          skill.description?.toLowerCase().includes(query) ||
          skill.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // 类型过滤
    if (filterType !== 'all') {
      result = result.filter((skill) => skill.type === filterType);
    }

    // 状态过滤
    if (filterStatus === 'enabled') {
      result = result.filter((skill) => skill.enabled !== false);
    } else if (filterStatus === 'disabled') {
      result = result.filter((skill) => skill.enabled === false);
    }

    return result;
  }, [skills, searchQuery, filterType, filterStatus]);

  // ========== 分组 ==========
  const groupedSkills = useMemo(() => {
    const groups: Record<string, SkillDefinition[]> = {
      core: [],
      scene: [],
    };

    for (const skill of filteredSkills) {
      const category = skill.category || 'scene';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(skill);
    }

    return groups;
  }, [filteredSkills]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <Sparkles size={24} className="text-primary" />
          <div>
            <h1 className="text-xl font-bold">Skill 库</h1>
            <p className="text-sm text-text-secondary">{filteredSkills.length} 个 Skill</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadSkills()}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary rounded transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 搜索和过滤栏 */}
      <div className="p-4 border-b border-bg-tertiary space-y-3">
        {/* 搜索框 */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="搜索 Skill（名称、ID、描述、标签）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-secondary border border-bg-tertiary rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 border rounded transition-colors ${
              showFilters
                ? 'bg-primary/10 border-primary text-primary'
                : 'bg-bg-secondary border-bg-tertiary hover:bg-bg-tertiary'
            }`}
          >
            <Filter size={16} />
            <span className="text-sm">筛选</span>
          </button>
        </div>

        {/* 筛选选项 */}
        {showFilters && (
          <div className="flex gap-4">
            {/* 类型筛选 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">类型:</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="bg-bg-secondary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                <option value="prompt">Prompt</option>
                <option value="agent">Agent</option>
                <option value="workflow">Workflow</option>
              </select>
            </div>

            {/* 状态筛选 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">状态:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="bg-bg-secondary border border-bg-tertiary rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                <option value="enabled">已启用</option>
                <option value="disabled">未启用</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Skill 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && skills.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw size={24} className="animate-spin text-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center text-sm text-error py-8">{error}</div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center text-sm text-text-secondary py-8">
            {searchQuery || filterType !== 'all' || filterStatus !== 'all'
              ? '没有找到匹配的 Skill'
              : '暂无 Skill'}
          </div>
        ) : (
          <div className="space-y-6">
            {/* 核心 Skills */}
            {groupedSkills.core && groupedSkills.core.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-text-secondary mb-3">
                  ⭐ 核心 Skills
                  <span className="ml-2 text-xs">({groupedSkills.core.length})</span>
                </h2>
                <div className="space-y-2">
                  {groupedSkills.core.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onClick={() => setSelectedSkill(skill)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 场景 Skills */}
            {groupedSkills.scene && groupedSkills.scene.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-text-secondary mb-3">
                  📝 场景 Skills
                  <span className="ml-2 text-xs">({groupedSkills.scene.length})</span>
                </h2>
                <div className="space-y-2">
                  {groupedSkills.scene.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onClick={() => setSelectedSkill(skill)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Skill 详情对话框 */}
      {selectedSkill && (
        <SkillDetailDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      )}
    </div>
  );
}

// ========== Skill 卡片组件 ==========
interface SkillCardProps {
  skill: SkillDefinition;
  onClick: () => void;
}

function SkillCard({ skill, onClick }: SkillCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-bg-secondary border border-bg-tertiary rounded-lg hover:border-primary/50 transition-colors"
    >
      {/* 头部：名称 + 状态 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold truncate">{skill.name}</h3>
            {skill.enabled ? (
              <Eye size={12} className="text-green-500 flex-shrink-0" />
            ) : (
              <EyeOff size={12} className="text-text-secondary flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-text-tertiary font-mono truncate">{skill.id}</p>
        </div>
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded flex-shrink-0">
          {skill.type}
        </span>
      </div>

      {/* 描述 */}
      <p className="text-sm text-text-secondary line-clamp-2 mb-3">{skill.description}</p>

      {/* 依赖工具 */}
      {skill.requiredTools && skill.requiredTools.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-text-secondary mb-1">依赖工具:</p>
          <div className="flex gap-1 flex-wrap">
            {skill.requiredTools.slice(0, 5).map((tool) => (
              <span key={tool} className="text-xs bg-bg-primary px-1.5 py-0.5 rounded">
                {tool}
              </span>
            ))}
            {skill.requiredTools.length > 5 && (
              <span className="text-xs text-text-secondary">+{skill.requiredTools.length - 5}</span>
            )}
          </div>
        </div>
      )}

      {/* 标签 */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {skill.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs bg-bg-primary px-1.5 py-0.5 rounded">
              #{tag}
            </span>
          ))}
          {skill.tags.length > 3 && (
            <span className="text-xs text-text-secondary">+{skill.tags.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ========== Skill 详情对话框 ==========
interface SkillDetailDialogProps {
  skill: SkillDefinition;
  onClose: () => void;
}

function SkillDetailDialog({ skill, onClose }: SkillDetailDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary w-full max-w-2xl max-h-[80vh] rounded-lg shadow-xl flex flex-col">
        {/* 标题 */}
        <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
          <h2 className="text-lg font-bold">{skill.name}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ID 和类型 */}
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-text-secondary">ID</p>
              <p className="text-sm font-mono">{skill.id}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">类型</p>
              <p className="text-sm">
                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded">{skill.type}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">状态</p>
              <p className="text-sm">
                {skill.enabled ? (
                  <span className="text-green-500 flex items-center gap-1">
                    <Eye size={14} /> 已启用
                  </span>
                ) : (
                  <span className="text-text-secondary flex items-center gap-1">
                    <EyeOff size={14} /> 未启用
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* 描述 */}
          <div>
            <p className="text-sm font-semibold mb-2">描述</p>
            <p className="text-sm text-text-secondary">{skill.description}</p>
          </div>

          {/* 依赖工具 */}
          {skill.requiredTools && skill.requiredTools.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">依赖工具</p>
              <div className="flex gap-2 flex-wrap">
                {skill.requiredTools.map((tool) => (
                  <span key={tool} className="text-sm bg-bg-primary px-2 py-1 rounded">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 触发器 */}
          {skill.triggers && skill.triggers.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">触发器</p>
              <div className="flex gap-2 flex-wrap">
                {skill.triggers.map((trigger) => (
                  <span key={trigger} className="text-sm bg-bg-primary px-2 py-1 rounded font-mono">
                    {trigger}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 标签 */}
          {skill.tags && skill.tags.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">标签</p>
              <div className="flex gap-2 flex-wrap">
                {skill.tags.map((tag) => (
                  <span key={tag} className="text-sm bg-primary/20 text-primary px-2 py-1 rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 优先级 */}
          {skill.priority !== undefined && (
            <div>
              <p className="text-sm font-semibold mb-2">优先级</p>
              <p className="text-sm">{skill.priority}</p>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-bg-tertiary flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-tertiary rounded hover:bg-bg-primary transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
