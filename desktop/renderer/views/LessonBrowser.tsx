// ============================================================
// Xuanji Desktop - LessonBrowser 组件
// ============================================================
// 职责：
// - 经验教训浏览器视图
// - 展示所有学习经验（success/failure/best_practice/pitfall/optimization）
// - 支持搜索、过滤、排序
// - 支持查看、编辑、删除
// - 支持导出/导入
// ============================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  Lightbulb,
  Filter,
  ChevronDown,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useLessonStore, type LessonSearchOptions, type LessonType, type LessonDomain } from '../stores';
import type { LessonEvent } from '../stores/lessonStore';

interface LessonBrowserProps {
  onClose: () => void;
}

type ViewMode = 'list' | 'detail';
type FilterType = 'all' | LessonType;
type FilterDomain = 'all' | LessonDomain;
type FilterVerification = 'all' | 'verified' | 'unverified' | 'applied';
type SortBy = 'created' | 'updated' | 'confidence' | 'type';

const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  success: '成功经验',
  failure: '失败教训',
  best_practice: '最佳实践',
  pitfall: '常见陷阱',
  optimization: '优化建议',
};

const LESSON_TYPE_ICONS: Record<LessonType, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4" />,
  failure: <XCircle className="w-4 h-4" />,
  best_practice: <Zap className="w-4 h-4" />,
  pitfall: <AlertTriangle className="w-4 h-4" />,
  optimization: <TrendingUp className="w-4 h-4" />,
};

const LESSON_TYPE_COLORS: Record<LessonType, string> = {
  success: 'text-green-400',
  failure: 'text-red-400',
  best_practice: 'text-blue-400',
  pitfall: 'text-yellow-400',
  optimization: 'text-purple-400',
};

const LESSON_DOMAIN_LABELS: Record<LessonDomain, string> = {
  coding: '编程',
  debugging: '调试',
  tool_usage: '工具使用',
  communication: '沟通',
  decision_making: '决策',
  workflow: '工作流',
};

export default function LessonBrowser({ onClose }: LessonBrowserProps) {
  // ========== Store 数据 ==========
  const {
    lessons,
    stats,
    loading,
    error,
    loadLessons,
    loadStats,
    deleteLesson,
    updateLesson,
    exportLessons,
    importLessons,
    refresh,
  } = useLessonStore();

  // ========== 本地状态 ==========
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedLesson, setSelectedLesson] = useState<LessonEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterDomain, setFilterDomain] = useState<FilterDomain>('all');
  const [filterVerification, setFilterVerification] = useState<FilterVerification>('all');
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [showFilters, setShowFilters] = useState(false);

  // ========== 初始化加载 ==========
  useEffect(() => {
    refresh();
  }, []);

  // ========== 搜索和过滤 ==========
  const handleSearch = async () => {
    const options: LessonSearchOptions = {
      onlyVerified: filterVerification === 'verified',
    };

    if (searchQuery.trim()) {
      options.query = searchQuery.trim();
    }

    if (filterType !== 'all') {
      options.type = filterType;
    }

    if (filterDomain !== 'all') {
      options.domain = filterDomain;
    }

    await loadLessons(options);
  };

  // ========== 过滤和排序 ==========
  const filteredAndSortedLessons = useMemo(() => {
    let result = [...lessons];

    // 验证过滤
    if (filterVerification === 'verified') {
      result = result.filter((l) => l.verification.verified);
    } else if (filterVerification === 'unverified') {
      result = result.filter((l) => !l.verification.verified);
    } else if (filterVerification === 'applied') {
      result = result.filter((l) => l.verification.applied);
    }

    // 排序
    result.sort((a, b) => {
      if (sortBy === 'created') {
        return b.timestamp - a.timestamp;
      } else if (sortBy === 'confidence') {
        const confA = a.analysis?.confidence || 0;
        const confB = b.analysis?.confidence || 0;
        return confB - confA;
      } else if (sortBy === 'type') {
        return a.type.localeCompare(b.type);
      }
      return b.timestamp - a.timestamp;
    });

    return result;
  }, [lessons, filterVerification, sortBy]);

  // ========== 导出/导入 ==========
  const handleExport = async () => {
    const data = await exportLessons();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xuanji-lessons-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importLessons(data);
      alert(`导入成功：${result.imported} 条，跳过：${result.skipped} 条`);
    };
    input.click();
  };

  // ========== 删除确认 ==========
  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这条经验教训吗？')) {
      await deleteLesson(id);
      if (selectedLesson?.id === id) {
        setSelectedLesson(null);
        setViewMode('list');
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* ========== 标题栏 ========== */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-3">
          <Lightbulb className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-text-primary">经验教训浏览器</h1>
            <p className="text-sm text-text-secondary">
              共 {stats?.total || 0} 条 · 已验证 {stats?.verified || 0} 条 · 已应用 {stats?.applied || 0} 条
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      {/* ========== 工具栏 ========== */}
      <div className="px-6 py-4 border-b border-bg-tertiary space-y-3">
        {/* 搜索和操作 */}
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-bg-secondary rounded-lg border border-bg-tertiary">
            <Search className="w-4 h-4 text-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索经验教训..."
              className="flex-1 bg-transparent text-text-primary text-sm outline-none"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          >
            搜索
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
          >
            <Filter className="w-5 h-5 text-text-secondary" />
          </button>
          <button onClick={refresh} className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors">
            <RefreshCw className="w-5 h-5 text-text-secondary" />
          </button>
          <button onClick={handleExport} className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors">
            <Download className="w-5 h-5 text-text-secondary" />
          </button>
          <button onClick={handleImport} className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors">
            <Upload className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* 过滤器 */}
        {showFilters && (
          <div className="flex items-center gap-4 px-4 py-3 bg-bg-secondary rounded-lg">
            {/* 类型过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">类型：</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-3 py-1 bg-bg-tertiary text-text-primary text-sm rounded border border-bg-tertiary focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                {(Object.keys(LESSON_TYPE_LABELS) as LessonType[]).map((type) => (
                  <option key={type} value={type}>
                    {LESSON_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            {/* 领域过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">领域：</span>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value as FilterDomain)}
                className="px-3 py-1 bg-bg-tertiary text-text-primary text-sm rounded border border-bg-tertiary focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                {(Object.keys(LESSON_DOMAIN_LABELS) as LessonDomain[]).map((domain) => (
                  <option key={domain} value={domain}>
                    {LESSON_DOMAIN_LABELS[domain]}
                  </option>
                ))}
              </select>
            </div>

            {/* 验证状态过滤 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">验证：</span>
              <select
                value={filterVerification}
                onChange={(e) => setFilterVerification(e.target.value as FilterVerification)}
                className="px-3 py-1 bg-bg-tertiary text-text-primary text-sm rounded border border-bg-tertiary focus:outline-none focus:border-primary"
              >
                <option value="all">全部</option>
                <option value="verified">已验证</option>
                <option value="unverified">未验证</option>
                <option value="applied">已应用</option>
              </select>
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">排序：</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-1 bg-bg-tertiary text-text-primary text-sm rounded border border-bg-tertiary focus:outline-none focus:border-primary"
              >
                <option value="created">创建时间</option>
                <option value="confidence">置信度</option>
                <option value="type">类型</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ========== 内容区域 ========== */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="h-full flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}

        {error && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-text-primary">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div className="h-full flex">
            {/* 列表视图 */}
            <div className={`${viewMode === 'detail' && selectedLesson ? 'w-1/3' : 'flex-1'} border-r border-bg-tertiary overflow-y-auto`}>
              {filteredAndSortedLessons.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <Lightbulb className="w-12 h-12 text-text-secondary mx-auto mb-4" />
                    <p className="text-text-secondary">暂无经验教训</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {filteredAndSortedLessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      onClick={() => {
                        setSelectedLesson(lesson);
                        setViewMode('detail');
                      }}
                      className={`p-4 bg-bg-secondary rounded-lg border cursor-pointer transition-all ${
                        selectedLesson?.id === lesson.id
                          ? 'border-primary'
                          : 'border-bg-tertiary hover:border-primary/50'
                      }`}
                    >
                      {/* 标题和类型 */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-1">
                          <span className={LESSON_TYPE_COLORS[lesson.type]}>
                            {LESSON_TYPE_ICONS[lesson.type]}
                          </span>
                          <h3 className="font-semibold text-text-primary text-sm">
                            {lesson.experience.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          {lesson.verification.verified && (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          )}
                          {lesson.verification.applied && (
                            <span className="text-xs text-blue-400">已应用 {lesson.verification.applicationCount}次</span>
                          )}
                        </div>
                      </div>

                      {/* 描述 */}
                      <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                        {lesson.experience.description}
                      </p>

                      {/* 元信息 */}
                      <div className="flex items-center gap-4 text-xs text-text-secondary">
                        <span>{LESSON_TYPE_LABELS[lesson.type]}</span>
                        <span>{LESSON_DOMAIN_LABELS[lesson.domain]}</span>
                        {lesson.analysis?.confidence && (
                          <span>置信度：{(lesson.analysis.confidence * 100).toFixed(0)}%</span>
                        )}
                        <span>{new Date(lesson.timestamp).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 详情视图 */}
            {viewMode === 'detail' && selectedLesson && (
              <div className="flex-1 overflow-y-auto p-6">
                {/* 操作按钮 */}
                <div className="flex items-center justify-end gap-2 mb-4">
                  <button
                    onClick={() => handleDelete(selectedLesson.id)}
                    className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setViewMode('list');
                      setSelectedLesson(null);
                    }}
                    className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-text-secondary" />
                  </button>
                </div>

                {/* 标题和类型 */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={LESSON_TYPE_COLORS[selectedLesson.type]}>
                      {LESSON_TYPE_ICONS[selectedLesson.type]}
                    </span>
                    <span className="text-sm text-text-secondary">
                      {LESSON_TYPE_LABELS[selectedLesson.type]} · {LESSON_DOMAIN_LABELS[selectedLesson.domain]}
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold text-text-primary mb-2">
                    {selectedLesson.experience.title}
                  </h2>
                  <p className="text-text-secondary">{selectedLesson.experience.description}</p>
                </div>

                {/* 核心教训 */}
                {selectedLesson.lesson && (
                  <div className="mb-6 p-4 bg-primary/10 rounded-lg border border-primary/20">
                    <h3 className="font-semibold text-text-primary mb-2">💡 核心教训</h3>
                    <p className="text-sm text-text-primary mb-2">{selectedLesson.lesson.summary}</p>
                    <p className="text-sm text-primary font-medium">
                      关键要点：{selectedLesson.lesson.keyTakeaway}
                    </p>
                    {selectedLesson.lesson.actionableInsight && (
                      <p className="text-sm text-text-secondary mt-2">
                        行动建议：{selectedLesson.lesson.actionableInsight}
                      </p>
                    )}
                  </div>
                )}

                {/* 分析 */}
                {selectedLesson.analysis && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-text-primary mb-3">🔍 分析</h3>
                    {selectedLesson.analysis.rootCause && (
                      <div className="mb-2">
                        <span className="text-sm font-medium text-text-secondary">根本原因：</span>
                        <p className="text-sm text-text-primary">{selectedLesson.analysis.rootCause}</p>
                      </div>
                    )}
                    {selectedLesson.analysis.whatWentWrong && (
                      <div className="mb-2">
                        <span className="text-sm font-medium text-text-secondary">出错原因：</span>
                        <p className="text-sm text-text-primary">{selectedLesson.analysis.whatWentWrong}</p>
                      </div>
                    )}
                    {selectedLesson.analysis.whatWentRight && (
                      <div className="mb-2">
                        <span className="text-sm font-medium text-text-secondary">成功因素：</span>
                        <p className="text-sm text-text-primary">{selectedLesson.analysis.whatWentRight}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-sm font-medium text-text-secondary">置信度：</span>
                      <span className="text-sm text-primary ml-2">
                        {(selectedLesson.analysis.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* 上下文 */}
                <div className="mb-6">
                  <h3 className="font-semibold text-text-primary mb-3">📝 上下文</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-text-secondary">任务：</span>
                      <p className="text-text-primary">{selectedLesson.context.task}</p>
                    </div>
                    <div>
                      <span className="font-medium text-text-secondary">我的行为：</span>
                      <p className="text-text-primary">{selectedLesson.context.myAction}</p>
                    </div>
                    {selectedLesson.context.toolsUsed.length > 0 && (
                      <div>
                        <span className="font-medium text-text-secondary">使用的工具：</span>
                        <p className="text-text-primary">{selectedLesson.context.toolsUsed.join(', ')}</p>
                      </div>
                    )}
                    {selectedLesson.context.files.length > 0 && (
                      <div>
                        <span className="font-medium text-text-secondary">相关文件：</span>
                        <p className="text-text-primary font-mono text-xs">
                          {selectedLesson.context.files.join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 验证状态 */}
                <div className="mb-6 p-4 bg-bg-secondary rounded-lg">
                  <h3 className="font-semibold text-text-primary mb-3">✅ 验证状态</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-text-secondary">验证状态：</span>
                      <span className={`ml-2 ${selectedLesson.verification.verified ? 'text-green-400' : 'text-yellow-400'}`}>
                        {selectedLesson.verification.verified ? '已验证' : '未验证'}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">应用状态：</span>
                      <span className={`ml-2 ${selectedLesson.verification.applied ? 'text-blue-400' : 'text-text-secondary'}`}>
                        {selectedLesson.verification.applied ? '已应用' : '未应用'}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">应用次数：</span>
                      <span className="ml-2 text-text-primary">{selectedLesson.verification.applicationCount}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">成功次数：</span>
                      <span className="ml-2 text-text-primary">{selectedLesson.verification.successCount}</span>
                    </div>
                  </div>
                </div>

                {/* 元信息 */}
                <div className="text-xs text-text-secondary space-y-1">
                  <div>
                    <span>ID：</span>
                    <span className="font-mono">{selectedLesson.id}</span>
                  </div>
                  <div>
                    <span>创建时间：</span>
                    <span>{new Date(selectedLesson.timestamp).toLocaleString('zh-CN')}</span>
                  </div>
                  <div>
                    <span>发现方式：</span>
                    <span>{selectedLesson.experience.discoveredBy}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
