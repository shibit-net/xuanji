// ============================================================
// Xuanji Desktop - MemoryBrowser 组件
// ============================================================
// 职责：
// - 记忆浏览器视图
// - 展示所有统一记忆（exchange/fact/preference/skill/error/decision/pattern）
// - 支持搜索、过滤、排序
// - 支持查看、编辑、删除、质量反馈
// - 支持导出/导入
// ============================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  Brain,
  Filter,
  ChevronDown,
  Download,
  Upload,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Trash2,
  Eye,
  EyeOff,
  AlertCircle,
  Edit2,
} from 'lucide-react';
import { useMemoryStore, type SearchOptions } from '../stores';
import type { UnifiedMemory, UnifiedMemoryType } from '../types/models';
import MemoryEditor from '../components/MemoryEditor';

interface MemoryBrowserProps {
  onClose: () => void;
}

type ViewMode = 'list' | 'detail';
type FilterType = 'all' | UnifiedMemoryType;
type FilterQuality = 'all' | 'high' | 'medium' | 'low';
type FilterStatus = 'all' | 'visible' | 'hidden' | 'obsolete' | 'needsReview';
type SortBy = 'created' | 'updated' | 'quality' | 'type';

const MEMORY_TYPE_LABELS: Record<UnifiedMemoryType, string> = {
  exchange: '对话交互',
  fact: '事实知识',
  preference: '用户偏好',
  skill: '技能',
  error: '错误记录',
  decision: '决策记录',
  pattern: '模式',
};

const MEMORY_TYPE_ICONS: Record<UnifiedMemoryType, string> = {
  exchange: '💬',
  fact: '📚',
  preference: '⭐',
  skill: '🔧',
  error: '❌',
  decision: '🎯',
  pattern: '🔄',
};

export default function MemoryBrowser({ onClose }: MemoryBrowserProps) {
  // ========== Store 数据 ==========
  const { memories, stats, loading, error, loadMemories, loadStats, deleteMemory, updateMemory, provideFeedback, exportMemories, importMemories, refresh } =
    useMemoryStore();

  // ========== 本地状态 ==========
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedMemory, setSelectedMemory] = useState<UnifiedMemory | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterQuality, setFilterQuality] = useState<FilterQuality>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [showFilters, setShowFilters] = useState(false);

  // ========== 初始化加载 ==========
  useEffect(() => {
    refresh();
  }, []);

  // ========== 搜索和过滤 ==========
  const handleSearch = async () => {
    const options: SearchOptions = {
      excludeHidden: filterStatus === 'visible',
      excludeObsolete: filterStatus !== 'obsolete',
    };

    if (searchQuery.trim()) {
      options.query = searchQuery.trim();
    }

    if (filterType !== 'all') {
      options.type = filterType;
    }

    if (filterQuality === 'high') {
      options.minQuality = 0.7;
    } else if (filterQuality === 'medium') {
      options.minQuality = 0.4;
      options.minAccuracy = 0; // 允许 low 的上界
    } else if (filterQuality === 'low') {
      options.minQuality = 0;
      options.minAccuracy = 0;
    }

    await loadMemories(options);
  };

  // ========== 排序 ==========
  const sortedMemories = useMemo(() => {
    const result = [...memories];

    result.sort((a, b) => {
      if (sortBy === 'created') {
        return b.createdAt - a.createdAt;
      } else if (sortBy === 'updated') {
        return b.updatedAt - a.updatedAt;
      } else if (sortBy === 'quality') {
        const qualityA = (a.quality.accuracy + a.quality.confidence) / 2;
        const qualityB = (b.quality.accuracy + b.quality.confidence) / 2;
        return qualityB - qualityA;
      } else if (sortBy === 'type') {
        return a.type.localeCompare(b.type);
      }
      return 0;
    });

    return result;
  }, [memories, sortBy]);

  // ========== 质量反馈处理 ==========
  const handleFeedback = async (id: string, feedback: 'thumbsup' | 'thumbsdown' | 'obsolete') => {
    await provideFeedback(id, feedback);
    // 如果当前查看的是该记忆，刷新详情
    if (selectedMemory?.id === id) {
      const updated = memories.find(m => m.id === id);
      if (updated) {
        setSelectedMemory(updated);
      }
    }
  };

  // ========== 删除处理 ==========
  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这条记忆吗？此操作不可撤销。')) {
      await deleteMemory(id);
      if (selectedMemory?.id === id) {
        setSelectedMemory(null);
        setViewMode('list');
      }
    }
  };

  // ========== 导出处理 ==========
  const handleExport = async () => {
    const data = await exportMemories();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xuanji-memories-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ========== 导入处理 ==========
  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const result = await importMemories(data);
        alert(`导入完成！成功：${result.imported} 条，跳过：${result.skipped} 条`);
      } catch (err) {
        alert('导入失败：JSON 格式错误');
      }
    };
    input.click();
  };

  // ========== 计算质量分数 ==========
  const calculateQualityScore = (memory: UnifiedMemory): number => {
    return (memory.quality.accuracy + memory.quality.confidence) / 2;
  };

  // ========== 质量等级 ==========
  const getQualityLevel = (score: number): 'high' | 'medium' | 'low' => {
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[95vw] h-[90vh] bg-[#1E1E1E] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* ========== 标题栏 ========== */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2D2D2D]">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">记忆浏览器</h2>
            {stats && (
              <span className="text-sm text-gray-400">
                （{stats.total} 条记忆）
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#2D2D2D] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* ========== 工具栏 ========== */}
        <div className="px-6 py-3 border-b border-[#2D2D2D] flex items-center gap-3">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索记忆内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2 bg-[#2D2D2D] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 过滤器按钮 */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              showFilters ? 'bg-blue-600 text-white' : 'bg-[#2D2D2D] text-gray-300 hover:bg-[#3D3D3D]'
            }`}
          >
            <Filter className="w-4 h-4" />
            过滤器
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {/* 刷新按钮 */}
          <button
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2 bg-[#2D2D2D] text-gray-300 rounded-lg hover:bg-[#3D3D3D] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-[#2D2D2D] text-gray-300 rounded-lg hover:bg-[#3D3D3D] transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            导出
          </button>

          {/* 导入按钮 */}
          <button
            onClick={handleImport}
            className="px-4 py-2 bg-[#2D2D2D] text-gray-300 rounded-lg hover:bg-[#3D3D3D] transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            导入
          </button>
        </div>

        {/* ========== 过滤器面板 ========== */}
        {showFilters && (
          <div className="px-6 py-4 border-b border-[#2D2D2D] bg-[#252525] flex items-center gap-6">
            {/* 类型过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">类型：</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-3 py-1 bg-[#1E1E1E] text-white rounded border border-[#3D3D3D] focus:outline-none focus:border-blue-500"
              >
                <option value="all">全部</option>
                {Object.entries(MEMORY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {MEMORY_TYPE_ICONS[key as UnifiedMemoryType]} {label}
                  </option>
                ))}
              </select>
            </div>

            {/* 质量过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">质量：</span>
              <select
                value={filterQuality}
                onChange={(e) => setFilterQuality(e.target.value as FilterQuality)}
                className="px-3 py-1 bg-[#1E1E1E] text-white rounded border border-[#3D3D3D] focus:outline-none focus:border-blue-500"
              >
                <option value="all">全部</option>
                <option value="high">高（≥70%）</option>
                <option value="medium">中（40-70%）</option>
                <option value="low">低（&lt;40%）</option>
              </select>
            </div>

            {/* 状态过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">状态：</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="px-3 py-1 bg-[#1E1E1E] text-white rounded border border-[#3D3D3D] focus:outline-none focus:border-blue-500"
              >
                <option value="all">全部</option>
                <option value="visible">可见</option>
                <option value="hidden">已隐藏</option>
                <option value="obsolete">已过时</option>
                <option value="needsReview">需审核</option>
              </select>
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">排序：</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-1 bg-[#1E1E1E] text-white rounded border border-[#3D3D3D] focus:outline-none focus:border-blue-500"
              >
                <option value="updated">最近更新</option>
                <option value="created">创建时间</option>
                <option value="quality">质量分数</option>
                <option value="type">记忆类型</option>
              </select>
            </div>

            {/* 应用按钮 */}
            <button
              onClick={handleSearch}
              className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              应用
            </button>
          </div>
        )}

        {/* ========== 主内容区 ========== */}
        <div className="flex-1 flex overflow-hidden">
          {/* ========== 记忆列表 ========== */}
          <div className="w-2/3 border-r border-[#2D2D2D] overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                加载中...
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 m-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-400">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}

            {!loading && !error && sortedMemories.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <Brain className="w-12 h-12 mb-2 opacity-50" />
                <p>暂无记忆</p>
              </div>
            )}

            {!loading && sortedMemories.map((memory) => {
              const qualityScore = calculateQualityScore(memory);
              const qualityLevel = getQualityLevel(qualityScore);

              return (
                <div
                  key={memory.id}
                  onClick={() => {
                    setSelectedMemory(memory);
                    setViewMode('detail');
                  }}
                  className={`p-4 border-b border-[#2D2D2D] cursor-pointer transition-colors ${
                    selectedMemory?.id === memory.id ? 'bg-[#2D2D2D]' : 'hover:bg-[#252525]'
                  } ${memory.hidden ? 'opacity-50' : ''}`}
                >
                  {/* 顶部：类型标签 + 时间 + 状态图标 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{MEMORY_TYPE_ICONS[memory.type]}</span>
                      <span className="text-xs text-gray-400">
                        {MEMORY_TYPE_LABELS[memory.type]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {memory.hidden && <EyeOff className="w-4 h-4 text-gray-500" title="已隐藏" />}
                      {memory.obsolete && <Clock className="w-4 h-4 text-yellow-500" title="已过时" />}
                      {memory.needsReview && <AlertCircle className="w-4 h-4 text-orange-500" title="需审核" />}
                      <span className="text-xs text-gray-500">
                        {new Date(memory.updatedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>

                  {/* 内容预览 */}
                  <p className="text-sm text-gray-300 line-clamp-2 mb-2">
                    {memory.content}
                  </p>

                  {/* 底部：质量指示器 + 操作按钮 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <div className="w-20 h-2 bg-[#3D3D3D] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              qualityLevel === 'high'
                                ? 'bg-green-500'
                                : qualityLevel === 'medium'
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${qualityScore * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">
                          {(qualityScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        使用 {memory.quality.useCount} 次
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFeedback(memory.id, 'thumbsup');
                        }}
                        className="p-1 hover:bg-[#3D3D3D] rounded transition-colors"
                        title="有用"
                      >
                        <ThumbsUp className="w-3 h-3 text-gray-400 hover:text-green-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFeedback(memory.id, 'thumbsdown');
                        }}
                        className="p-1 hover:bg-[#3D3D3D] rounded transition-colors"
                        title="无用"
                      >
                        <ThumbsDown className="w-3 h-3 text-gray-400 hover:text-red-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFeedback(memory.id, 'obsolete');
                        }}
                        className="p-1 hover:bg-[#3D3D3D] rounded transition-colors"
                        title="过时"
                      >
                        <Clock className="w-3 h-3 text-gray-400 hover:text-yellow-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMemory(memory);
                          setShowEditor(true);
                        }}
                        className="p-1 hover:bg-[#3D3D3D] rounded transition-colors"
                        title="编辑"
                      >
                        <Edit2 className="w-3 h-3 text-gray-400 hover:text-blue-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(memory.id);
                        }}
                        className="p-1 hover:bg-[#3D3D3D] rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ========== 详情面板 ========== */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedMemory ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Eye className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-lg">选择一条记忆查看详情</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* 标题 */}
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                    <span className="text-3xl">{MEMORY_TYPE_ICONS[selectedMemory.type]}</span>
                    {MEMORY_TYPE_LABELS[selectedMemory.type]}
                  </h3>
                  <button
                    onClick={() => setShowEditor(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    编辑
                  </button>
                </div>

                {/* 内容 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">内容</h4>
                  <p className="text-white whitespace-pre-wrap">{selectedMemory.content}</p>
                </div>

                {/* 质量评分 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">质量评分</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-gray-500">准确性</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-2 bg-[#3D3D3D] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${selectedMemory.quality.accuracy * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-white">
                          {(selectedMemory.quality.accuracy * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">可信度</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-2 bg-[#3D3D3D] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${selectedMemory.quality.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-white">
                          {(selectedMemory.quality.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">使用次数</span>
                      <div className="text-sm text-white mt-1">{selectedMemory.quality.useCount} 次</div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">最后使用</span>
                      <div className="text-sm text-white mt-1">
                        {new Date(selectedMemory.quality.lastUsed).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 元数据 */}
                {selectedMemory.metadata && Object.keys(selectedMemory.metadata).length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-400 mb-2">元数据</h4>
                    <pre className="text-xs text-gray-300 bg-[#2D2D2D] p-3 rounded overflow-x-auto">
                      {JSON.stringify(selectedMemory.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* 来源追溯 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">来源追溯</h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-500">来源：</span>
                      <span className="text-white ml-2">{selectedMemory.provenance.source}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">提取方法：</span>
                      <span className="text-white ml-2">{selectedMemory.provenance.extractionMethod}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">可追溯：</span>
                      <span className="text-white ml-2">{selectedMemory.provenance.traceable ? '是' : '否'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">可验证：</span>
                      <span className="text-white ml-2">{selectedMemory.provenance.verifiable ? '是' : '否'}</span>
                    </div>
                  </div>
                </div>

                {/* 状态标记 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">状态</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedMemory.hidden && (
                      <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">已隐藏</span>
                    )}
                    {selectedMemory.obsolete && (
                      <span className="px-2 py-1 bg-yellow-700 text-yellow-300 text-xs rounded">已过时</span>
                    )}
                    {selectedMemory.needsReview && (
                      <span className="px-2 py-1 bg-orange-700 text-orange-300 text-xs rounded">需审核</span>
                    )}
                    {!selectedMemory.hidden && !selectedMemory.obsolete && !selectedMemory.needsReview && (
                      <span className="px-2 py-1 bg-green-700 text-green-300 text-xs rounded">正常</span>
                    )}
                  </div>
                </div>

                {/* 时间戳 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">时间信息</h4>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-gray-500">创建时间：</span>
                      <span className="text-white ml-2">
                        {new Date(selectedMemory.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">更新时间：</span>
                      <span className="text-white ml-2">
                        {new Date(selectedMemory.updatedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========== 统计栏 ========== */}
        {stats && (
          <div className="px-6 py-3 border-t border-[#2D2D2D] bg-[#252525] flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-6">
              <span>总计：{stats.total}</span>
              <span>高质量：{stats.byQuality.high}</span>
              <span>中质量：{stats.byQuality.medium}</span>
              <span>低质量：{stats.byQuality.low}</span>
              <span>已隐藏：{stats.hidden}</span>
              <span>已过时：{stats.obsolete}</span>
              <span>需审核：{stats.needsReview}</span>
            </div>
            <div>
              显示：{sortedMemories.length} / {stats.total}
            </div>
          </div>
        )}
      </div>

      {/* ========== 编辑器对话框 ========== */}
      {showEditor && selectedMemory && (
        <MemoryEditor
          memory={selectedMemory}
          onSave={async (id, updates) => {
            await updateMemory(id, updates);
            // 更新本地选中的记忆
            const updated = memories.find(m => m.id === id);
            if (updated) {
              setSelectedMemory(updated);
            }
          }}
          onCancel={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
