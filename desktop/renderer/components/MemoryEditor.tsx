// ============================================================
// MemoryEditor - 记忆编辑器组件
// ============================================================
// 职责：
// - 编辑记忆的内容、类型、质量、状态
// - 验证输入有效性
// - 保存更改到 UnifiedMemoryStore
// ============================================================

import React, { useState } from 'react';
import { Save, X, AlertCircle, Info } from 'lucide-react';
import type { UnifiedMemory, UnifiedMemoryType } from '../types/models';
import { useToast } from './Toast';

interface MemoryEditorProps {
  memory: UnifiedMemory;
  onSave: (id: string, updates: Partial<UnifiedMemory>) => Promise<void>;
  onCancel: () => void;
}

const MEMORY_TYPE_OPTIONS: Array<{ value: UnifiedMemoryType; label: string }> = [
  { value: 'exchange', label: '💬 对话交互' },
  { value: 'fact', label: '📚 事实知识' },
  { value: 'preference', label: '⭐ 用户偏好' },
  { value: 'skill', label: '🔧 技能' },
  { value: 'error', label: '❌ 错误记录' },
  { value: 'decision', label: '🎯 决策记录' },
  { value: 'pattern', label: '🔄 模式' },
];

export default function MemoryEditor({ memory, onSave, onCancel }: MemoryEditorProps) {
  const toast = useToast();

  // ========== 表单状态 ==========
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<UnifiedMemoryType>(memory.type);
  const [accuracy, setAccuracy] = useState(memory.quality.accuracy);
  const [confidence, setConfidence] = useState(memory.quality.confidence);
  const [hidden, setHidden] = useState(memory.hidden);
  const [obsolete, setObsolete] = useState(memory.obsolete);
  const [needsReview, setNeedsReview] = useState(memory.needsReview);
  const [metadataJson, setMetadataJson] = useState(
    JSON.stringify(memory.metadata, null, 2)
  );

  // ========== 验证和错误 ==========
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ========== 验证表单 ==========
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!content.trim()) {
      newErrors.content = '内容不能为空';
    }

    if (accuracy < 0 || accuracy > 1) {
      newErrors.accuracy = '准确性必须在 0-1 之间';
    }

    if (confidence < 0 || confidence > 1) {
      newErrors.confidence = '可信度必须在 0-1 之间';
    }

    // 验证 metadata JSON
    try {
      JSON.parse(metadataJson);
    } catch (err) {
      newErrors.metadata = 'JSON 格式错误';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ========== 保存处理 ==========
  const handleSave = async () => {
    if (!validate()) {
      toast.error('请修正表单错误');
      return;
    }

    setSaving(true);
    try {
      const updates: Partial<UnifiedMemory> = {
        content: content.trim(),
        type,
        quality: {
          ...memory.quality,
          accuracy,
          confidence,
        },
        hidden,
        obsolete,
        needsReview,
        metadata: JSON.parse(metadataJson),
      };

      await onSave(memory.id, updates);
      toast.success('保存成功');
      onCancel();
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[800px] max-h-[90vh] bg-[#1E1E1E] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* ========== 标题栏 ========== */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2D2D2D]">
          <h2 className="text-xl font-semibold text-white">编辑记忆</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-[#2D2D2D] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* ========== 表单区域 ========== */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 类型选择 */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              记忆类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as UnifiedMemoryType)}
              className="w-full px-4 py-2 bg-[#2D2D2D] text-white rounded-lg border border-[#3D3D3D] focus:outline-none focus:border-blue-500"
            >
              {MEMORY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* 内容编辑 */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              内容 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className={`w-full px-4 py-2 bg-[#2D2D2D] text-white rounded-lg border ${
                errors.content ? 'border-red-500' : 'border-[#3D3D3D]'
              } focus:outline-none focus:border-blue-500`}
              placeholder="输入记忆内容..."
            />
            {errors.content && (
              <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.content}
              </p>
            )}
          </div>

          {/* 质量评分 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 准确性 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                准确性（0-1）
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={accuracy}
                  onChange={(e) => setAccuracy(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={accuracy}
                  onChange={(e) => setAccuracy(parseFloat(e.target.value))}
                  className={`w-20 px-2 py-1 bg-[#2D2D2D] text-white rounded border ${
                    errors.accuracy ? 'border-red-500' : 'border-[#3D3D3D]'
                  } focus:outline-none focus:border-blue-500`}
                />
              </div>
              {errors.accuracy && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {errors.accuracy}
                </p>
              )}
            </div>

            {/* 可信度 */}
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                可信度（0-1）
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={confidence}
                  onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={confidence}
                  onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  className={`w-20 px-2 py-1 bg-[#2D2D2D] text-white rounded border ${
                    errors.confidence ? 'border-red-500' : 'border-[#3D3D3D]'
                  } focus:outline-none focus:border-blue-500`}
                />
              </div>
              {errors.confidence && (
                <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {errors.confidence}
                </p>
              )}
            </div>
          </div>

          {/* 状态标记 */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-3">
              状态标记
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-300">已隐藏（不在常规搜索中显示）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={obsolete}
                  onChange={(e) => setObsolete(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-300">已过时（信息不再准确）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={needsReview}
                  onChange={(e) => setNeedsReview(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-300">需审核（质量较低，需要人工审核）</span>
              </label>
            </div>
          </div>

          {/* 元数据编辑 */}
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              元数据（JSON）
            </label>
            <textarea
              value={metadataJson}
              onChange={(e) => setMetadataJson(e.target.value)}
              rows={8}
              className={`w-full px-4 py-2 bg-[#2D2D2D] text-white rounded-lg border ${
                errors.metadata ? 'border-red-500' : 'border-[#3D3D3D]'
              } focus:outline-none focus:border-blue-500 font-mono text-sm`}
              placeholder="{}"
            />
            {errors.metadata && (
              <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.metadata}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
              <Info className="w-3 h-3" />
              元数据用于存储额外的结构化信息，如标签、分类等
            </p>
          </div>

          {/* 只读信息 */}
          <div className="p-4 bg-[#252525] rounded-lg border border-[#2D2D2D]">
            <h4 className="text-sm font-semibold text-gray-400 mb-3">只读信息</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">记忆 ID：</span>
                <span className="text-gray-300 ml-2 font-mono text-xs">{memory.id}</span>
              </div>
              <div>
                <span className="text-gray-500">使用次数：</span>
                <span className="text-gray-300 ml-2">{memory.quality.useCount}</span>
              </div>
              <div>
                <span className="text-gray-500">来源：</span>
                <span className="text-gray-300 ml-2">{memory.provenance.source}</span>
              </div>
              <div>
                <span className="text-gray-500">提取方法：</span>
                <span className="text-gray-300 ml-2">{memory.provenance.extractionMethod}</span>
              </div>
              <div>
                <span className="text-gray-500">创建时间：</span>
                <span className="text-gray-300 ml-2">
                  {new Date(memory.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <div>
                <span className="text-gray-500">更新时间：</span>
                <span className="text-gray-300 ml-2">
                  {new Date(memory.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ========== 底部操作栏 ========== */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#2D2D2D] bg-[#252525]">
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-[#2D2D2D] text-gray-300 rounded-lg hover:bg-[#3D3D3D] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
