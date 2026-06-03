// ============================================================
// AgentToolSelector - Agent 工具选择配置区块
// ============================================================

import { memo } from 'react';
import { Search } from 'lucide-react';
import { t } from '@/core/i18n';
import { MEDIA_TOOL_NAMES, TOOL_CATEGORY_STYLE } from './shared/constants';

interface AgentToolSelectorProps {
  config: any;
  setConfig: (config: any) => void;
  canEdit: (field: string) => boolean;
  errors: Record<string, string>;
  toolsLoading: boolean;
  toolSearchQuery: string;
  setToolSearchQuery: (query: string) => void;
  filteredTools: any[];
  groupedTools: Record<string, any[]>;
  toggleTool: (toolName: string) => void;
  updateToolConfig: (toolName: string, key: string, value: unknown) => void;
  selectAllTools: () => void;
  deselectAllTools: () => void;
}

function AgentToolSelector({
  config,
  setConfig,
  canEdit,
  errors,
  toolsLoading,
  toolSearchQuery,
  setToolSearchQuery,
  filteredTools,
  groupedTools,
  toggleTool,
  updateToolConfig,
  selectAllTools,
  deselectAllTools,
}: AgentToolSelectorProps) {
  return (
    <>
      <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-xs text-blue-400 mb-2">
          {t('agent.editor.tools_hint_intro')}
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
          <li>{t('agent.editor.tools_hint_item1')}</li>
          <li>{t('agent.editor.tools_hint_item2')}</li>
          <li>{t('agent.editor.tools_hint_item3')}</li>
        </ul>
      </div>

      {toolsLoading ? (
        <p className="text-sm text-muted-foreground">{t('agent.editor.loading_tools')}</p>
      ) : (
        <>
          {/* 搜索和批量操作 */}
          <div className="space-y-3 mb-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                placeholder={t('agent.editor.search_tools_ext')}
                value={toolSearchQuery}
                onChange={(e) => setToolSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllTools}
                className="px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded"
              >
              {t('agent.editor.tools_select_all')}
              </button>
              <button
                type="button"
                onClick={deselectAllTools}
                className="px-3 py-1.5 text-xs bg-accent/10 text-accent-foreground/60 hover:bg-primary/20 rounded"
              >
                {t('agent.editor.tools_deselect_all')}
              </button>
              <span className="ml-auto text-xs text-muted-foreground/50 self-center">
                {t('agent.editor.tools_enabled_count', { enabled: (config.tools || []).filter((t: any) => t.enabled !== false).length, total: (config.tools || []).length })}<span className="ml-0.5">{t('agent.editor.tools_enabled_count_suffix').trim()}</span>
              </span>
            </div>
          </div>

          {/* 按类别分组的工具列表 */}
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {Object.entries(groupedTools).map(([category, tools]) => (
              <div key={category}>
                {(() => {
                  const s = TOOL_CATEGORY_STYLE[category] || { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: category };
                  return (
                    <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                      <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
                      <span className="text-[10px] text-muted-foreground/40">{tools.length}</span>
                    </div>
                  );
                })()}
                <div className="space-y-2 pl-2">
                  {tools.map((tool: any) => {
                    const toolConfig = (config.tools || []).find((t: any) => t.name === tool.name);
                    const isEnabled = toolConfig ? toolConfig.enabled !== false : false;

                    const cat = tool.category || 'other';
                    const style = TOOL_CATEGORY_STYLE[cat] || { bg: 'bg-card', border: 'border-border' };
                    return (
                      <div
                        key={tool.name}
                        className={`p-2.5 rounded-lg border ${style.bg} ${style.border} mb-1.5`}
                      >
                        <label className={`flex items-start gap-3 ${canEdit('tools') ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleTool(tool.name)}
                            disabled={!canEdit('tools')}
                            className="mt-0.5 rounded disabled:opacity-50"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground">{tool.name}</div>
                            {tool.description && (
                              <div className="text-xs text-muted-foreground/50 mt-0.5">{tool.description}</div>
                            )}
                            {/* 自定义描述（可选） */}
                            {isEnabled && toolConfig?.description && (
                              <div className="text-xs text-primary mt-1">
                                {t('agent.editor.tools_custom_desc', { desc: toolConfig.description })}
                              </div>
                            )}
                            {/* 媒体工具：提示使用全局配置（生图/生视频无需配置） */}
                            {isEnabled && MEDIA_TOOL_NAMES.has(tool.name) && tool.name !== 'generate_image' && tool.name !== 'generate_video' && (
                              <div className="mt-2 p-2 bg-accent/5 rounded border border-border/50 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  API 凭证使用全局配置，在设置 → 模型配置中统一管理
                                </p>
                                {tool.name === 'generate_image' && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-xs text-muted-foreground">默认分辨率</label>
                                      <select
                                        value={(toolConfig?.config as any)?.defaultSize || '2K'}
                                        onChange={(e) => updateToolConfig(tool.name, 'defaultSize', e.target.value)}
                                        className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
                                      >
                                        <option value="1K">1K (1024²)</option>
                                        <option value="2K">2K (2048²)</option>
                                        <option value="4K">4K (4096²)</option>
                                      </select>
                                    </div>
                                    <div className="flex items-end pb-0.5">
                                      <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={(toolConfig?.config as any)?.watermark === true}
                                          onChange={(e) => updateToolConfig(tool.name, 'watermark', e.target.checked)}
                                          className="rounded"
                                        />
                                        <span className="text-xs text-muted-foreground">水印</span>
                                      </label>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <p className="text-sm text-muted-foreground/50 text-center py-4">
              {t('agent.editor.tools_no_match')}
            </p>
          )}

          {errors.tools && (
            <p className="text-xs text-red-400 mt-2">⚠️ {errors.tools}</p>
          )}
        </>
      )}
    </>
  );
}

export default memo(AgentToolSelector);
