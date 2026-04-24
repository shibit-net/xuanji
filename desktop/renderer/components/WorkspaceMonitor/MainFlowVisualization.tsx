/**
 * MainFlowVisualization - 主流程状态展示
 *
 * 类似"正在回忆中"的简洁状态提示
 */

import React, { useEffect, useState } from 'react';
import { workspaceStore, type WorkspacePhase } from '../../stores/workspaceStore';
import './MainFlowVisualization.css';

export function MainFlowVisualization() {
  const [currentPhase, setCurrentPhase] = useState<WorkspacePhase | null>(null);

  useEffect(() => {
    console.log('[MainFlowVisualization] Component mounted, subscribing to workspaceStore');

    const unsubscribe = workspaceStore.subscribe(() => {
      const phase = workspaceStore.getCurrentPhase();
      console.log('[MainFlowVisualization] Store updated, current phase:', phase);
      setCurrentPhase(phase);
    });

    // 初始加载
    const initialPhase = workspaceStore.getCurrentPhase();
    console.log('[MainFlowVisualization] Initial phase:', initialPhase);
    setCurrentPhase(initialPhase);

    return unsubscribe;
  }, []);

  // 如果没有正在执行的阶段，不显示
  if (!currentPhase) {
    return null;
  }

  // 意图分析阶段显示详细信息
  if (currentPhase.name === '意图分析' && currentPhase.data) {
    const { matchMethod, intentClassifier, scene } = currentPhase.data;

    return (
      <div className="main-flow-status">
        <div className="status-indicator">
          <div className="spinner" />
          <div className="status-content">
            <span className="status-text">{getPhaseText(currentPhase.name)}</span>
            {matchMethod === 'intent-classifier' && intentClassifier && (
              <div className="status-details">
                <span className="detail-item">
                  🤖 {intentClassifier.model}
                </span>
                <span className="detail-item">
                  📍 {intentClassifier.scene}
                </span>
                <span className="detail-item">
                  🎯 {intentClassifier.complexity}
                </span>
              </div>
            )}
            {matchMethod === 'none' && scene && (
              <div className="status-details">
                <span className="detail-item">
                  📍 {scene}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-flow-status">
      <div className="status-indicator">
        <div className="spinner" />
        <span className="status-text">{getPhaseText(currentPhase.name)}</span>
      </div>
    </div>
  );
}

/**
 * 获取阶段文本
 */
function getPhaseText(phaseName: string): string {
  switch (phaseName) {
    case '意图分析':
      return '正在分析意图...';
    case '任务规划':
      return '正在规划任务...';
    case '任务执行':
      return '正在执行任务...';
    case '结果汇总':
      return '正在汇总结果...';
    default:
      return '正在处理...';
  }
}
