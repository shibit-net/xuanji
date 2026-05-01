// ============================================================
// Workspace Monitor - Canvas 渲染器
// ============================================================

import type {
  WorkspaceState,
  Point,
  AgentState,
  SubAgentState,
  SubAgentData,
  AgentMoment,
  TimelineEvent,
} from './types';
import { LayoutEngine } from './LayoutEngine';
import { AnimationEngine } from './AnimationEngine';

export interface CanvasRendererConfig {
  dpr: number;
  containerWidth: number;
  containerHeight: number;
}

export class CanvasRenderer {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private layoutEngine!: LayoutEngine;
  private animationEngine!: AnimationEngine;
  private lastFrameTime: number = 0;
  private state: WorkspaceState | null = null;
  private hoveredAgent: string | null = null;
  private treePositions: Map<string, Point> = new Map();
  private exitProgressMap: Map<string, number> = new Map();
  private prevAgentIds: Set<string> = new Set();

  private viewScale = 1.0;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private targetViewScale = 1.0;
  private targetViewOffsetX = 0;
  private targetViewOffsetY = 0;
  private readonly MIN_ZOOM = 0.1;
  private readonly MAX_ZOOM = 5.0;
  private containerWidth = 0;
  private containerHeight = 0;
  private dpr = 1;

  private subAgentSnapshot = '';
  private occupiedDirty = true;
  /** wrapText 结果缓存，避免相同文本每帧重复 measureText */
  private wrapCache = new Map<string, string[]>();

  constructor(canvas: OffscreenCanvas, config: CanvasRendererConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文');
    this.ctx = ctx;

    this.dpr = config.dpr;
    this.containerWidth = config.containerWidth;
    this.containerHeight = config.containerHeight;
    this.canvas.width = this.containerWidth * this.dpr;
    this.canvas.height = this.containerHeight * this.dpr;

    this.layoutEngine = new LayoutEngine(
      Math.max(this.containerWidth, 5000),
      Math.max(this.containerHeight, 4000),
    );
    this.animationEngine = new AnimationEngine();
    this.resetView();
  }

  /**
   * 绘制圆角矩形（兼容性处理）
   */
  private roundRect(x: number, y: number, width: number, height: number, radius: number) {
    if (typeof (this.ctx as any).roundRect === 'function') {
      // 使用原生 API
      (this.ctx as any).roundRect(x, y, width, height, radius);
    } else {
      // 手动绘制圆角矩形
      this.ctx.moveTo(x + radius, y);
      this.ctx.lineTo(x + width - radius, y);
      this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      this.ctx.lineTo(x + width, y + height - radius);
      this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      this.ctx.lineTo(x + radius, y + height);
      this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      this.ctx.lineTo(x, y + radius);
      this.ctx.quadraticCurveTo(x, y, x + radius, y);
    }
  }

  /** 更新画布尺寸（由主线程通过消息触发） */
  updateCanvasSize(width: number, height: number, dpr: number) {
    this.containerWidth = width;
    this.containerHeight = height;
    this.dpr = dpr;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.layoutEngine.updateSize(
      Math.max(width, 5000),
      Math.max(height, 4000),
    );
  }

  /** 获取容器 CSS 尺寸 */
  getContainerSize(): { width: number; height: number } {
    return { width: this.containerWidth, height: this.containerHeight };
  }

  /**
   * 更新状态（增量优化：仅在 agent ID/status/strategy 变化时重算布局）
   */
  updateState(state: WorkspaceState) {
    this.state = state;

    const prevSnapshot = this.subAgentSnapshot;
    const newSnapshot = this.buildSubAgentSnapshot();

    if (newSnapshot !== prevSnapshot) {
      // 结构性变化（agent 增删/状态变更/策略切换）→ 重新计算布局
      this.subAgentSnapshot = newSnapshot;
      if (this.state.subAgents.length > 0) {
        this.treePositions = this.layoutEngine.computeTreePositions(this.state.subAgents);
      }
      if (this.state.subAgents.length > 0) {
        const boundaries = this.layoutEngine.computeTeamBoundaries(this.state.subAgents, this.treePositions);
        this.state.teamBoundaries = boundaries;
        const nonTeamConnections = this.state.collaborations.filter(c => !c.isTeamConnection);
        const mainId = this.state.mainAgent.id;
        const teamConnections = boundaries.map((team) => ({
          from: mainId,
          to: team.teamId,
          type: 'team' as any,
          active: true,
          isTeamConnection: true,
          teamBounds: team.bounds,
        }));
        this.state.collaborations = [...nonTeamConnections, ...teamConnections];
      }
      // 裁剪位置缓存
      const activeIds = new Set(this.state.subAgents.map(a => a.id));
      activeIds.add(this.state.mainAgent.id);
      this.layoutEngine.prunePositionCache(activeIds);
      this.occupiedDirty = true;
    }
    // 非结构性变化（moment/timeline/thinkingText）→ 仅更新动画，跳过布局重算

    this.updateAnimations();
  }

  /**
   * 获取 LayoutEngine 实例
   */
  getLayoutEngine(): LayoutEngine {
    return this.layoutEngine;
  }

  /**
   * 获取当前树形布局位置
   */
  getTreePositions(): Map<string, Point> {
    return this.treePositions;
  }

  /**
   * 增量更新动画（不再全部 clear 后重建，保留粒子流动等持续动画）
   */
  private updateAnimations() {
    if (!this.state) return;

    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainRadius = this.layoutEngine.getMainAgentRadius();
    const keepIds = new Set<string>();

    // 主 Agent 动画
    const statusAnimMap: Record<string, string> = {
      thinking: 'pulse', executing: 'rotate', waiting: 'blink', error: 'shake',
    };
    const animType = statusAnimMap[this.state.mainAgent.status];
    if (animType) {
      const mainAnimId = `${animType}-main`;
      keepIds.add(mainAnimId);
      if (!this.animationEngine.has(mainAnimId)) {
        let anim;
        switch (animType) {
          case 'pulse': anim = this.animationEngine.createPulseAnimation('main', mainPos, mainRadius); break;
          case 'rotate': anim = this.animationEngine.createRotateAnimation('main', mainPos, mainRadius); break;
          case 'blink': anim = this.animationEngine.createBlinkAnimation('main', mainPos, mainRadius); break;
          case 'shake': anim = this.animationEngine.createShakeAnimation('main', mainPos); break;
        }
        if (anim) this.animationEngine.register(anim);
      }
    }

    // 协作关系粒子动画
    this.state.collaborations.forEach((collab) => {
      if (!collab.active) return;
      const particleId = `particle-${collab.from}-${collab.to}`;
      keepIds.add(particleId);
      if (this.animationEngine.has(particleId)) return;

      const fromPos = this.getAgentPosition(collab.from);
      const toPos = this.getAgentPosition(collab.to);
      if (fromPos && toPos) {
        const path = this.layoutEngine.getConnectionPath(fromPos, toPos);
        const color = collab.type === 'task' ? '#34D399' : '#7C8CF5';
        const anim = this.animationEngine.createParticleFlowAnimation(
          `${collab.from}-${collab.to}`, path, color, 3
        );
        this.animationEngine.register(anim);
      }
    });

    // 移除不再需要的动画
    this.animationEngine.removeExcept(keepIds);
  }

  /**
   * 获取 Agent 或团队边界框的位置
   */
  private getAgentPosition(agentId: string): Point | null {
    if (!this.state) return null;

    if (agentId === this.state.mainAgent.id) {
      return this.layoutEngine.getMainAgentPosition();
    }

    // 团队边界框位置
    if (agentId.startsWith('team-') && this.state.teamBoundaries) {
      const teamName = agentId.slice(5);
      const team = this.state.teamBoundaries.find(t => t.teamId === agentId);
      if (team?.bounds) {
        return {
          x: team.bounds.x + team.bounds.width / 2,
          y: team.bounds.y,
        };
      }
    }

    // 树形布局位置
    const treePos = this.treePositions.get(agentId);
    if (treePos) return treePos;

    return null;
  }

  /**
   * 渲染单帧（由主线程 rAF 通过 Worker 消息驱动）
   */
  renderFrame(timestamp: number) {
    // 限制 deltaTime 上下限（处理首帧、卡顿恢复、系统时钟调整）
    const rawDelta = timestamp - this.lastFrameTime;
    const deltaTime = Math.max(0, Math.min(rawDelta, 100));
    this.lastFrameTime = timestamp;

    // 平滑视图动画（缓动到目标）
    this.smoothViewAnimation(deltaTime);

    // 更新动画（传入 currentTime）
    this.animationEngine.update(timestamp, deltaTime);

    // 清空视口
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.clearViewport();

    // 应用视图变换
    this.ctx.setTransform(
      this.viewScale * this.dpr, 0,
      0, this.viewScale * this.dpr,
      this.viewOffsetX * this.dpr, this.viewOffsetY * this.dpr,
    );

    // 绘制内容
    if (this.state) {
      // 每帧实时计算耗时（避免主线程 100ms 定时器触发 JSON.stringify 序列化开销）
      this.computeLiveDurations(this.state);

      // 每帧重置占用区域并注册节点（布局由 updateState 在结构变化时更新）
      this.occupiedDirty = false;
      this.layoutEngine.resetOccupied();
      this.registerNodeOccupiedAreas();

      // 更新出场动画进度
      this.updateExitAnimations(deltaTime);

      this.drawTeamBoundaries();
      this.drawConnections();
      this.drawSubAgents(timestamp);
      this.drawMainAgent(timestamp);
      this.drawAllThinkingBubbles();
    } else {
      this.drawEmptyState();
    }

    // 绘制动画叠加层
    this.animationEngine.draw(this.ctx, timestamp);
  }

  /**
   * 每帧实时计算 running moment 的耗时（消除主线程 100ms 定时器）
   * worker 端使用 Date.now() 计算，与主线程可能有微小偏差但不影响展示
   */
  private computeLiveDurations(state: WorkspaceState): void {
    const now = Date.now();

    // 主 agent
    const mainMoment = state.mainAgent.currentMoment;
    if (mainMoment?.status === 'running' && mainMoment.startTime) {
      mainMoment.durationMs = now - mainMoment.startTime;
    }

    // 所有子 agent
    for (const agent of state.subAgents) {
      const moment = agent.currentMoment;
      if (moment?.status === 'running' && moment.startTime) {
        moment.durationMs = now - moment.startTime;
      }
    }

    // 全局统计
    if (state.stats.startTime) {
      state.stats.duration = now - state.stats.startTime;
    }
  }

  /**
   * 构建 subAgents 快照字符串，用于检测布局是否需要更新
   */
  private buildSubAgentSnapshot(): string {
    if (!this.state) return '';
    return this.state.subAgents.map(a => `${a.id}:${a.status}:${a.multiAgent?.strategy || ''}`).sort().join(',');
  }

  /**
   * 清空视口
   */
  private clearViewport() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#2D2D2D';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ─── 视图变换控制（无限画布 + 缩放/平移）─────────────────

  /** 平滑视图动画（线性插值到目标，90% 在 ~130ms 内完成） */
  private smoothViewAnimation(deltaTime: number) {
    const lerpFactor = Math.min(1, deltaTime * 0.015);
    if (Math.abs(this.targetViewScale - this.viewScale) > 0.001) {
      this.viewScale += (this.targetViewScale - this.viewScale) * lerpFactor;
    } else {
      this.viewScale = this.targetViewScale;
    }
    if (Math.abs(this.targetViewOffsetX - this.viewOffsetX) > 0.5) {
      this.viewOffsetX += (this.targetViewOffsetX - this.viewOffsetX) * lerpFactor;
    } else {
      this.viewOffsetX = this.targetViewOffsetX;
    }
    if (Math.abs(this.targetViewOffsetY - this.viewOffsetY) > 0.5) {
      this.viewOffsetY += (this.targetViewOffsetY - this.viewOffsetY) * lerpFactor;
    } else {
      this.viewOffsetY = this.targetViewOffsetY;
    }
  }

  /**
   * 缩放画布（以屏幕坐标的某点为中心）
   * @param factor 缩放因子 (> 1 放大, < 1 缩小)
   * @param screenX 缩放中心屏幕 X（CSS 像素，相对于 canvas 左上角）
   * @param screenY 缩放中心屏幕 Y
   */
  zoom(factor: number, screenX: number, screenY: number) {
    const newScale = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.targetViewScale * factor));
    const virtualX = (screenX - this.viewOffsetX) / this.viewScale;
    const virtualY = (screenY - this.viewOffsetY) / this.viewScale;
    // 交互式缩放即时生效，不做平滑过渡（平滑过渡会导致鼠标滚轮/按钮缩放感延迟）
    this.targetViewScale = newScale;
    this.targetViewOffsetX = screenX - virtualX * newScale;
    this.targetViewOffsetY = screenY - virtualY * newScale;
    this.viewScale = this.targetViewScale;
    this.viewOffsetX = this.targetViewOffsetX;
    this.viewOffsetY = this.targetViewOffsetY;
  }

  /** 平移画布 */
  pan(deltaX: number, deltaY: number) {
    this.targetViewOffsetX += deltaX;
    this.targetViewOffsetY += deltaY;
    this.viewOffsetX = this.targetViewOffsetX;
    this.viewOffsetY = this.targetViewOffsetY;
  }

  /** 重置视图：居中显示主 agent（平滑过渡） */
  resetView() {
    const mainPos = this.layoutEngine.getMainAgentPosition();
    this.targetViewScale = 1.0;
    this.targetViewOffsetX = this.containerWidth / 2 - mainPos.x;
    this.targetViewOffsetY = this.containerHeight * 0.3 - mainPos.y;
  }

  /** 适配全部内容到视口 */
  zoomToFit() {
    const bounds = this.layoutEngine.getContentBounds();
    if (!bounds) {
      this.resetView();
      return;
    }
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const pad = 100;
    const scaleX = (this.containerWidth - pad * 2) / (contentW || 1);
    const scaleY = (this.containerHeight - pad * 2) / (contentH || 1);
    const fitScale = Math.min(scaleX, scaleY, 1.5);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    this.targetViewScale = Math.max(this.MIN_ZOOM, fitScale);
    this.targetViewOffsetX = this.containerWidth / 2 - centerX * this.targetViewScale;
    this.targetViewOffsetY = this.containerHeight / 2 - centerY * this.targetViewScale;
  }

  /** 获取当前视图状态 */
  getViewState(): { scale: number; offsetX: number; offsetY: number } {
    return {
      scale: this.viewScale,
      offsetX: this.viewOffsetX,
      offsetY: this.viewOffsetY,
    };
  }

  /** 将屏幕坐标转换为虚拟坐标 */
  screenToVirtual(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.viewOffsetX) / this.viewScale,
      y: (screenY - this.viewOffsetY) / this.viewScale,
    };
  }

  // ─── 出场动画（原子级淡入/淡出）─────────────────────────

  private readonly ENTER_DURATION = 300; // 淡入 300ms
  private readonly EXIT_DURATION = 500;  // 淡出 500ms

  /** 存储已知的团队成员 agent ID，用于跳过出场动画 */
  private teamMemberIds = new Set<string>();
  /** 记录团队成员从 subAgents 中消失的时间戳（用于延迟淡出） */
  private teamMemberAbsentSince = new Map<string, number>();
  /** 团队成员淡出宽限期：1 秒内不淡出（覆盖轮次切换的短暂缺失） */
  private readonly TEAM_MEMBER_EXIT_GRACE = 1000;

  /** 更新所有 agent 的出场动画进度 */
  private updateExitAnimations(deltaTime: number) {
    if (!this.state) return;

    const currentIds = new Set(this.state.subAgents.map(a => a.id));
    const now = performance.now();

    // 检测新出现的 agent → 开始淡入，同时记录团队成员
    for (const agent of this.state.subAgents) {
      if (agent.multiAgent?.type === 'agent_team') {
        this.teamMemberIds.add(agent.id);
        this.teamMemberAbsentSince.delete(agent.id); // 清空缺席记录
      }
      if (!this.prevAgentIds.has(agent.id)) {
        // 团队成员跳过淡入动画，直接显示（避免多轮辩论/任务切换时的闪烁）
        const isTeamMember = agent.multiAgent?.type === 'agent_team';
        this.exitProgressMap.set(agent.id, isTeamMember ? 1.0 : 0.01);
      }
    }

    // 更新所有进度
    for (const [id, progress] of this.exitProgressMap) {
      const agent = this.state.subAgents.find(a => a.id === id);
      if (agent) {
        // agent 仍存在：向 1.0 淡入
        if (progress < 1.0) {
          const newProgress = Math.min(1.0, progress + deltaTime / this.ENTER_DURATION);
          this.exitProgressMap.set(id, newProgress);
        }
      } else if (this.teamMemberIds.has(id)) {
        // 团队成员不在 subAgents 中，记录首次缺席时间
        if (!this.teamMemberAbsentSince.has(id)) {
          this.teamMemberAbsentSince.set(id, now);
        }
        const absentDuration = now - (this.teamMemberAbsentSince.get(id) || now);
        if (absentDuration < this.TEAM_MEMBER_EXIT_GRACE) {
          // 宽限期内保持可见（处理轮次切换的短暂缺失）
        } else {
          // 超过宽限期 → 减速淡出（比普通 agent 慢，等待 TeamEnd 后的视觉过渡）
          const newProgress = Math.max(0, progress - deltaTime / (this.EXIT_DURATION * 3));
          if (newProgress <= 0.01) {
            this.exitProgressMap.delete(id);
            this.teamMemberIds.delete(id);
            this.teamMemberAbsentSince.delete(id);
          } else {
            this.exitProgressMap.set(id, newProgress);
          }
        }
      } else {
        // agent 已不在列表中：向 0.0 淡出
        if (progress > 0) {
          const newProgress = Math.max(0, progress - deltaTime / this.EXIT_DURATION);
          if (newProgress <= 0.01) {
            this.exitProgressMap.delete(id);
          } else {
            this.exitProgressMap.set(id, newProgress);
          }
        }
      }
    }

    this.prevAgentIds = currentIds;
  }

  /** 获取 agent 的当前 alpha 值（包含出场动画） */
  private getAgentAlpha(agentId: string): number {
    return this.exitProgressMap.get(agentId) ?? 1.0;
  }

  /**
   * 绘制空状态（在屏幕坐标中绘制，需要先重置变换）
   */
  private drawEmptyState() {
    // 空状态在虚拟空间中心绘制，受视图变换影响
    const virtualCenter = this.screenToVirtual(
      this.containerWidth / 2,
      this.containerHeight / 2,
    );

    this.ctx.fillStyle = '#8A8A8A';
    this.ctx.font = '48px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🤖', virtualCenter.x, virtualCenter.y - 20);

    this.ctx.fillStyle = '#8A8A8A';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText('Agent 空闲中', virtualCenter.x, virtualCenter.y + 30);
  }

  /**
   * 预注册所有节点的占用区域（圆形节点 + 名称标签 + 类型标签 + 安全边距）
   * 确保后续放置的元素（气泡、moment标签）不会与节点区域重叠
   */
  private registerNodeOccupiedAreas() {
    if (!this.state) return;
    const safeGap = 40;

    // 主 Agent 节点区域
    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainR = this.layoutEngine.getMainAgentRadius();
    this.layoutEngine.addOccupied({
      x: mainPos.x - mainR - safeGap,
      y: mainPos.y - mainR - 20,
      width: (mainR + safeGap) * 2,
      height: mainR * 2 + 40 + 30 + 24, // 圆形 + 名称 + 类型标签 + moment 标签区域
    });

    // 子 Agent 节点区域（包含名称、类型标签、moment 标签空间 + 右侧工具堆栈）
    this.state.subAgents.forEach((agent) => {
      const pos = this.treePositions.get(agent.id);
      if (!pos) return;
      const r = this.layoutEngine.getSubAgentRadius();
      // 扩占右侧：工具堆栈（agent 右侧 200px）+ moment 标签可能的位置
      const hasTimeline = (agent.timelineEvents?.length || 0) > 0;
      const rightExt = hasTimeline ? r + 8 + 200 : r + safeGap;
      this.layoutEngine.addOccupied({
        x: pos.x - r - safeGap,
        y: pos.y - r - 32,
        width: r + safeGap + rightExt, // 非对称：右侧覆盖工具堆栈区域
        height: r * 2 + 32 + 30 + 24 + 10,
      });
    });

    // 主 Agent 的 timeline 和工具堆栈区域（扩展占用）
    if (this.state.mainAgent.timelineEvents?.length > 0) {
      const timelineOrigin = this.layoutEngine.getTimelineOrigin(mainPos, mainR);
      this.layoutEngine.addOccupied({
        x: timelineOrigin.x - 10,
        y: timelineOrigin.y - 10,
        width: mainR * 6 + 20,
        height: 44,
      });
    }

    // 团队边界框区域（宽度至少 200px 容纳标题栏，与 drawTeamBoundaries 保持一致）
    if (this.state.teamBoundaries) {
      this.state.teamBoundaries.forEach((team) => {
        if (!team.bounds) return;
        const minWidth = Math.max(team.bounds.width, 200);
        const dx = (team.bounds.width - minWidth) / 2;
        this.layoutEngine.addOccupied({
          x: team.bounds.x + dx,
          y: team.bounds.y - 4,
          width: minWidth,
          height: team.bounds.height + 8,
        });
      });
    }
  }

  /**
   * 绘制状态环（agent 圆圈外围，显示运行状态）
   */
  private drawStatusRing(center: Point, radius: number, status: string, currentTime: number, isDebateSpeaker: boolean = false) {
    const ringRadius = radius + 6;

    if (isDebateSpeaker) {
      this.ctx.strokeStyle = 'rgba(52, 211, 153, 1)';
      this.ctx.lineWidth = 4;
      this.ctx.shadowColor = 'rgba(52, 211, 153, 0.6)';
      this.ctx.shadowBlur = 15;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, ringRadius, 0, 2 * Math.PI);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      return;
    }

    if (status === 'running' || status === 'thinking' || status === 'executing') {
      const pulse = Math.sin(currentTime / 500) * 0.3 + 0.7;
      this.ctx.strokeStyle = `rgba(124, 140, 245, ${pulse})`;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, ringRadius, 0, 2 * Math.PI);
      this.ctx.stroke();
    } else if (status === 'success' || status === 'done') {
      this.ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, ringRadius, 0, 2 * Math.PI);
      this.ctx.stroke();
    } else if (status === 'error') {
      const shake = Math.sin(currentTime * 0.02) * 2;
      this.ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(center.x + shake, center.y, ringRadius, 0, 2 * Math.PI);
      this.ctx.stroke();
    } else {
      // idle / waiting / 默认
      this.ctx.strokeStyle = 'rgba(138, 138, 138, 0.3)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, ringRadius, 0, 2 * Math.PI);
      this.ctx.stroke();
    }
  }

  /**
   * 绘制主 Agent
   */
  private drawMainAgent(currentTime: number) {
    if (!this.state) return;

    const pos = this.layoutEngine.getMainAgentPosition();
    const radius = this.layoutEngine.getMainAgentRadius();
    const agent = this.state.mainAgent;

    // 绘制圆形背景
    this.ctx.fillStyle = this.getAgentColor(agent.status);
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
    this.ctx.fill();

    // 绘制边框
    this.ctx.strokeStyle = this.getAgentBorderColor(agent.status);
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // 绘制状态环
    this.drawStatusRing(pos, radius, agent.status, currentTime);

    // 🔧 辩论模式：中心圆显示辩题，否则显示图标
    if (agent.debateGoal) {
      this.ctx.fillStyle = '#fff';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      const maxWidth = radius * 1.6;
      const lines = this.wrapText(agent.debateGoal, maxWidth, 2);
      const fontSize = lines.length > 2 ? 10 : 11;
      this.ctx.font = `${fontSize}px sans-serif`;
      const lineHeight = fontSize + 3;
      const startY = pos.y - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        this.ctx.fillText(line, pos.x, startY + i * lineHeight);
      });
    } else {
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '32px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(agent.roleIcon || '🤖', pos.x, pos.y - 2);
    }

    // 绘制名称
    this.ctx.fillStyle = '#E4E4E4';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText(agent.name, pos.x, pos.y + radius + 20);

    // currentMoment 先渲染（右上位置），避免与 timeline 重叠
    if (agent.currentMoment) {
      this.drawMomentTag(pos, radius, agent.currentMoment);
    }

    // 工具调用堆栈（currentMoment 下方）
    const hasTimelineEvents = agent.timelineEvents && agent.timelineEvents.length > 0;
    if (hasTimelineEvents) {
      const recent5 = agent.timelineEvents.slice(-5);
      this.drawToolCallStack(pos, radius, recent5, currentTime);
    }
  }

  /**
   * 绘制子 Agent（带原子级淡入/淡出动画）
   * 所有内容（节点、气泡、标签、timeline）统一透明度
   */
  private drawSubAgents(currentTime: number) {
    if (!this.state) return;

    // 只过滤掉已完全淡出的 agent（exitProgress = 0）
    const visibleAgents = this.state.subAgents.filter(
      agent => this.getAgentAlpha(agent.id) > 0.01
    );

    visibleAgents.forEach((agent, index) => {
      const alpha = this.getAgentAlpha(agent.id);
      if (alpha <= 0.01) return;

      // 🔧 Team 容器节点由 drawTeamBoundaries 渲染为边界框，跳过普通渲染
      if (agent.id.startsWith('team-')) {
        const boundary = this.state?.teamBoundaries?.find(t => t.teamId === agent.id);
        if (boundary) {
          return; // 有对应边界框，跳过（由边界框表示）
        }
        // 没有边界框（团队刚启动），继续渲染为普通节点
      }

      // 使用树形布局位置（fallback 走位置缓存，避免按 index 跳动）
      const pos = this.layoutEngine.getStableAgentPosition(agent, this.treePositions, index, visibleAgents.length);

      const radius = this.layoutEngine.getSubAgentRadius();

      // 保存上下文，应用该 agent 的统一透明度
      this.ctx.save();
      this.ctx.globalAlpha = alpha;

      // 🔧 辩论模式特殊处理
      const isDebateAgent = agent.multiAgent?.strategy === 'debate';
      const isCurrentSpeaker = isDebateAgent && agent.status === 'running';
      const isRunning = agent.status === 'running';

      // 绘制圆形背景
      this.ctx.fillStyle = this.getSubAgentColor(agent.status);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      this.ctx.fill();

      // 绘制边框
      this.ctx.strokeStyle = this.getSubAgentBorderColor(agent.status);
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // 绘制状态环（辩论发言者用高亮环）
      this.drawStatusRing(pos, radius, agent.status, currentTime, isCurrentSpeaker);

      // 绘制图标（优先使用 roleIcon）
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '20px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      const icon = agent.roleIcon || this.getToolIcon(agent.name);
      this.ctx.fillText(icon, pos.x, pos.y - 1);

      // 🔧 绘制名称（辩论模式用角色颜色，角色标签由徽章单独展示）
      if (isDebateAgent && agent.multiAgent?.debateRole) {
        const roleColors: Record<string, string> = {
          affirmative: '#34D399',
          negative: '#F87171',
          judge: '#FBBF24',
        };
        // 去掉可能的角色前缀，徽章已标识角色
        const displayName = agent.name.replace(/^(正方|反方|裁判)·/, '');

        this.ctx.fillStyle = roleColors[agent.multiAgent.debateRole] || '#8A8A8A';
        this.ctx.font = 'bold 12px sans-serif';
        this.ctx.fillText(displayName, pos.x, pos.y + radius + 15);
      } else {
        // 普通模式：只显示名称
        this.ctx.fillStyle = '#8A8A8A';
        this.ctx.font = '11px sans-serif';
        this.ctx.fillText(agent.name, pos.x, pos.y + radius + 15);
      }

      // 绘制耗时（如果有）
      const hasDuration = agent.duration !== undefined && agent.duration > 0;
      if (hasDuration) {
        this.ctx.fillStyle = '#7C8CF5'; // primary color
        this.ctx.font = '10px monospace';
        const durationText = `${(agent.duration / 1000).toFixed(1)}s`;
        this.ctx.fillText(durationText, pos.x, pos.y + radius + 28);
      }

      // 绘制 Agent 类型标签（在耗时下方，避免重叠）
      if (agent.agentType) {
        const labelWidth = 60;
        const labelHeight = 20;
        const labelX = pos.x - labelWidth / 2;
        // 如果有耗时，标签放在耗时下方；否则直接放在名称下方
        const labelY = pos.y + radius + 28 + (hasDuration ? 14 : 0);
        this.layoutEngine.addOccupied({
          x: labelX - 8,
          y: labelY - 4,
          width: labelWidth + 16,
          height: labelHeight + 8,
        });
        this.drawAgentTypeLabel(pos, radius, agent.agentType, hasDuration ? 14 : 0);
      }

      // 绘制 Leader 徽章（Hierarchical 策略）
      if (agent.multiAgent?.strategy === 'hierarchical' && agent.multiAgent?.stepIndex === 0) {
        this.drawLeaderBadge(pos, radius);
      }

      // 绘制序号徽章（Sequential/Pipeline 策略）
      if ((agent.multiAgent?.strategy === 'sequential' || agent.multiAgent?.strategy === 'pipeline')
          && agent.multiAgent?.stepIndex !== undefined) {
        this.drawStepBadge(pos, radius, agent.multiAgent.stepIndex + 1);
      }

      // 绘制辩论徽章（Debate 策略）
      if (agent.multiAgent?.strategy === 'debate') {
        // 角色徽章（左上角）
        if (agent.multiAgent.debateRole) {
          this.drawDebateRoleBadge(pos, radius, agent.multiAgent.debateRole);
        }
        // 轮次徽章（右上角），maxRounds 存在即展示
        if (agent.multiAgent.maxRounds) {
          this.drawDebateRoundBadge(pos, radius, agent.multiAgent.currentRound || 1);
        }
      }

      // 如果正在执行，绘制进度环
      if (agent.status === 'running' && agent.progress !== undefined) {
        this.drawProgressRing(pos, radius, agent.progress, currentTime);
      }

      // 🔧 思考气泡已移至 drawAllThinkingBubbles() 统一绘制，确保在最上层

      // currentMoment 先渲染（右上位置），避免与 timeline 重叠
      if (agent.currentMoment) {
        this.drawMomentTag(pos, radius, agent.currentMoment);
      }

      // 区域3：右侧工具调用列表（currentMoment 下方，最近 5 个）
      if (agent.timelineEvents && agent.timelineEvents.length > 0) {
        const recent5 = agent.timelineEvents.slice(-5);
        this.drawToolCallStack(pos, radius, recent5, currentTime);
      }

      // 悬停时显示详情卡片
      if (this.hoveredAgent === agent.id) {
        this.drawAgentCard(pos, radius, agent);
      }

      this.ctx.restore();
    });
  }

  /**
   * 绘制团队边界框
   */
  private drawTeamBoundaries() {
    if (!this.state?.teamBoundaries) return;

    this.state.teamBoundaries.forEach((team) => {
      if (!team.bounds) return;

      const { x, y, width, height } = team.bounds;

      const strategyIcons: Record<string, string> = {
        sequential: '\u{1F4CB}', debate: '\u{1F4AC}', hierarchical: '\u{1F451}',
        pipeline: '\u{1F517}', parallel: '\u26A1',
      };

      const strategyColors: Record<string, string> = {
        sequential: 'rgba(124, 140, 245, 0.2)', debate: 'rgba(52, 211, 153, 0.2)',
        hierarchical: 'rgba(251, 191, 36, 0.2)', pipeline: 'rgba(139, 92, 246, 0.2)',
        parallel: 'rgba(236, 72, 153, 0.2)',
      };

      const borderColors: Record<string, string> = {
        sequential: 'rgba(124, 140, 245, 0.6)', debate: 'rgba(52, 211, 153, 0.6)',
        hierarchical: 'rgba(251, 191, 36, 0.6)', pipeline: 'rgba(139, 92, 246, 0.6)',
        parallel: 'rgba(236, 72, 153, 0.6)',
      };

      const titleAreaHeight = 32;
      const titleBgHeight = 28;
      const titleLeftPadding = 8;

      // ── 计算标题内容宽度 ──────────────────────────────
      const strategyLabel = team.strategy.charAt(0).toUpperCase() + team.strategy.slice(1);
      const icon = strategyIcons[team.strategy] || '\u{1F465}';

      this.ctx.font = 'bold 12px sans-serif';
      const teamNameWidth = this.ctx.measureText(team.teamName).width;
      this.ctx.font = '10px sans-serif';
      const strategyText = `(${strategyLabel})`;
      const strategyWidth = this.ctx.measureText(strategyText).width;

      // 右侧迭代信息（debate 轮次 / parallel 进度）
      let rightText = '';
      if (team.strategy === 'debate' && team.currentRound !== undefined && team.maxRounds !== undefined) {
        rightText = `Round ${team.currentRound}/${team.maxRounds}`;
      } else if (team.strategy === 'parallel') {
        const runningCount = team.memberIds.filter((memberId: string) => {
          const agent = this.state?.subAgents.find(a => a.id === memberId);
          return agent && agent.status === 'running';
        }).length;
        if (runningCount > 0) {
          rightText = `\u26A1 ${runningCount}/${team.memberIds.length} Running`;
        }
      }
      this.ctx.font = 'bold 11px monospace';
      const rightTextWidth = rightText ? this.ctx.measureText(rightText).width + 16 : 0;

      // 标题栏总宽度 = 左边距 + 图标 + 间距 + 名称 + 间距 + 策略标签 + 间距 + 右侧信息 + 右边距
      const titleBarWidth = titleLeftPadding + 16 + 4 + teamNameWidth + 6 + strategyWidth + (rightText ? 8 + rightTextWidth : 0) + titleLeftPadding;

      // ── 虚线框宽度至少不小于标题栏 ─────────────────────
      const effectiveWidth = Math.max(width, titleBarWidth + 16);
      const effectiveX = x + (width - effectiveWidth) / 2; // 居中扩展

      // 绘制虚线边界框
      this.ctx.fillStyle = strategyColors[team.strategy] || 'rgba(124, 140, 245, 0.1)';
      this.ctx.strokeStyle = borderColors[team.strategy] || 'rgba(124, 140, 245, 0.4)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 4]);
      this.ctx.beginPath();
      this.roundRect(effectiveX, y + titleAreaHeight, effectiveWidth, height - titleAreaHeight, 12);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // ── 绘制标题栏背景 ───────────────────────────────
      const titleBarX = effectiveX + (effectiveWidth - titleBarWidth) / 2;
      this.ctx.fillStyle = borderColors[team.strategy] || 'rgba(124, 140, 245, 0.8)';
      this.ctx.beginPath();
      this.roundRect(titleBarX, y, titleBarWidth, titleBgHeight, 6);
      this.ctx.fill();

      // ── 绘制标题内容 ─────────────────────────────────
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      const textY = y + titleBgHeight / 2;
      let cursorX = titleBarX + titleLeftPadding;

      // 图标
      this.ctx.font = '16px sans-serif';
      this.ctx.fillStyle = '#fff';
      this.ctx.fillText(icon, cursorX, textY);
      cursorX += 20;

      // 团队名称
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.fillStyle = '#fff';
      this.ctx.fillText(team.teamName, cursorX, textY);
      cursorX += teamNameWidth + 6;

      // 策略标签
      this.ctx.font = '10px sans-serif';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.fillText(strategyText, cursorX, textY);

      // 右侧迭代信息
      if (rightText) {
        this.ctx.font = 'bold 11px monospace';
        this.ctx.fillStyle = team.strategy === 'debate'
          ? 'rgba(52, 211, 153, 0.95)'
          : 'rgba(236, 72, 153, 1)';
        this.ctx.textAlign = 'right';
        this.ctx.fillText(rightText, titleBarX + titleBarWidth - titleLeftPadding, textY);
      }

      this.ctx.textAlign = 'left';

      // Debate 中心圆
      if (team.strategy === 'debate') {
        this.drawDebateCenterCircle(team);
      }

      // 🔧 修复：注册团队边界框到碰撞检测，防止思考气泡遮挡
      this.layoutEngine.addOccupied({
        x: team.bounds.x,
        y: team.bounds.y,
        width: team.bounds.width,
        height: team.bounds.height,
      });
    });
  }

  /**
   * 🔧 绘制辩论模式的中心圆
   */
  private drawDebateCenterCircle(team: any) {
    // 计算团队边界框的中心位置
    const centerX = team.bounds.x + team.bounds.width / 2;
    const centerY = team.bounds.y + team.bounds.height / 2;
    const centerRadius = 50; // 增大中心圆半径

    // 绘制中心圆背景
    this.ctx.fillStyle = 'rgba(52, 211, 153, 0.25)';
    this.ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, centerRadius, 0, 2 * Math.PI);
    this.ctx.fill();
    this.ctx.stroke();

    // 绘制辩论图标
    this.ctx.fillStyle = 'rgba(52, 211, 153, 1)';
    this.ctx.font = '24px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('💬', centerX, centerY - 10);

    // 🔧 绘制辩论主题（从 goal 中提取，多行显示）
    if (team.goal) {
      // 提取主题：取第一行或前20个字符
      const firstLine = team.goal.split('\n')[0];
      const topic = firstLine.length > 20 ? firstLine.substring(0, 18) + '...' : firstLine;

      // 分行显示，避免超出圆圈
      const maxWidth = centerRadius * 1.6; // 圆圈直径的80%
      const words = topic.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      // 简单的分行逻辑
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        this.ctx.font = 'bold 9px sans-serif';
        const metrics = this.ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }

      // 最多显示2行
      const displayLines = lines.slice(0, 2);
      const lineHeight = 11;
      const startY = centerY + 8 - ((displayLines.length - 1) * lineHeight) / 2;

      this.ctx.fillStyle = 'rgba(52, 211, 153, 1)';
      this.ctx.font = 'bold 9px sans-serif';
      displayLines.forEach((line, i) => {
        this.ctx.fillText(line, centerX, startY + i * lineHeight);
      });
    } else {
      // 默认显示 "Debate"
      this.ctx.fillStyle = 'rgba(52, 211, 153, 1)';
      this.ctx.font = 'bold 11px sans-serif';
      this.ctx.fillText('Debate', centerX, centerY + 12);
    }

    // 绘制从中心圆到每个成员的连接线
    if (team.memberIds && team.memberIds.length > 0) {
      team.memberIds.forEach((memberId: string) => {
        const memberPos = this.treePositions.get(memberId);
        if (memberPos) {
          // 绘制虚线连接
          this.ctx.strokeStyle = 'rgba(52, 211, 153, 0.4)';
          this.ctx.lineWidth = 2;
          this.ctx.setLineDash([5, 5]);
          this.ctx.beginPath();

          // 从中心圆边缘到成员节点边缘
          const angle = Math.atan2(memberPos.y - centerY, memberPos.x - centerX);
          const startX = centerX + centerRadius * Math.cos(angle);
          const startY = centerY + centerRadius * Math.sin(angle);

          const memberRadius = this.layoutEngine.getSubAgentRadius();
          const endX = memberPos.x - memberRadius * Math.cos(angle);
          const endY = memberPos.y - memberRadius * Math.sin(angle);

          this.ctx.moveTo(startX, startY);
          this.ctx.lineTo(endX, endY);
          this.ctx.stroke();
          this.ctx.setLineDash([]);
        }
      });
    }
  }

  /**
   * 绘制连接线（增强版：支持策略特定样式 + 团队连接）
   */
  private drawConnections() {
    if (!this.state) return;

    try {
      this.state.collaborations.forEach((collab) => {
        // 🔧 处理团队连接（主 agent → 团队边界框）
        if (collab.isTeamConnection && collab.teamBounds) {
          this.drawTeamConnection(collab);
          return;
        }

        // 普通连接（agent → agent）
        const fromPos = this.getAgentPosition(collab.from);
        const toPos = this.getAgentPosition(collab.to);

        if (fromPos && toPos) {
          const path = this.layoutEngine.getConnectionPath(fromPos, toPos);

          if (!path.points || !Array.isArray(path.points) || path.points.length === 0) {
            return;
          }

          // 策略特定的连线样式
          let lineColor = '#3A3A3A';
          let lineWidth = 1;
          let lineDash: number[] = [];

          if (collab.active) {
            // 根据策略类型设置颜色
            switch (collab.type) {
              case 'sequential':
                lineColor = '#7C8CF5';
                lineWidth = 2;
                break;
              case 'debate':
                lineColor = '#34D399';
                lineWidth = 2;
                lineDash = [5, 5]; // 虚线表示讨论
                break;
              case 'hierarchical':
                lineColor = collab.isLeaderConnection ? '#FBB024' : '#7C8CF5';
                lineWidth = collab.isLeaderConnection ? 3 : 2;
                break;
              case 'pipeline':
                lineColor = '#8B5CF6';
                lineWidth = 3;
                break;
              case 'parallel':
                lineColor = '#EC4899';
                lineWidth = 2;
                break;
              default:
                lineColor = collab.type === 'task' ? '#7C8CF5' : '#34D399';
                lineWidth = 2;
            }
          }

          this.ctx.strokeStyle = lineColor;
          this.ctx.lineWidth = lineWidth;
          this.ctx.setLineDash(lineDash);
          this.ctx.beginPath();

          path.points.forEach((point, index) => {
            if (index === 0) {
              this.ctx.moveTo(point.x, point.y);
            } else {
              this.ctx.lineTo(point.x, point.y);
            }
          });

          this.ctx.stroke();
          this.ctx.setLineDash([]);

          // 绘制箭头（Pipeline 和 Sequential）
          if (collab.active && (collab.type === 'pipeline' || collab.type === 'sequential')) {
            this.drawArrow(path.points[path.points.length - 2], path.points[path.points.length - 1], lineColor);
          }

          // 绘制序号（Sequential）
          if (collab.active && collab.type === 'sequential' && collab.sequenceNumber !== undefined) {
            const midPoint = this.layoutEngine.getConnectionLabelPosition(fromPos, toPos);
            this.drawSequenceNumber(midPoint, collab.sequenceNumber + 1);
          }

          // 绘制轮次标签（Debate）
          if (collab.active && collab.type === 'debate' && collab.debateRound !== undefined) {
            const midPoint = this.layoutEngine.getConnectionLabelPosition(fromPos, toPos);
            this.drawDebateRoundLabel(midPoint, collab.debateRound);
          }

          // 连线中点标签
          if (collab.label && collab.active) {
            this.drawConnectionLabel(fromPos, toPos, collab.label.text, collab.label.opacity);
          }
        }
      });
    } catch (err) {
      console.error('[CanvasRenderer] drawConnections 错误:', err);
    }
  }

  /**
   * 绘制箭头
   */
  private drawArrow(from: Point, to: Point, color: string) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowSize = 8;

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(to.x, to.y);
    this.ctx.lineTo(
      to.x - arrowSize * Math.cos(angle - Math.PI / 6),
      to.y - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.lineTo(
      to.x - arrowSize * Math.cos(angle + Math.PI / 6),
      to.y - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  /**
   * 🔧 绘制团队连接（主 agent → 团队边界框）
   */
  private drawTeamConnection(collab: any) {
    const mainPos = this.getAgentPosition('main');
    if (!mainPos || !collab.teamBounds) return;

    const bounds = collab.teamBounds;
    const mainRadius = this.layoutEngine.getMainAgentRadius();

    // 🔧 计算连接点：主 agent 底部中心 → 团队边界框顶部中心
    const fromX = mainPos.x;
    const fromY = mainPos.y + mainRadius + 65; // 主 agent 底部（圆形半径 + 名称标签 + 时间线条）

    const toX = bounds.x + bounds.width / 2; // 团队边界框顶部中心
    const toY = bounds.y; // 团队边界框顶部

    // 🔧 绘制虚线（更明显的样式）
    this.ctx.strokeStyle = 'rgba(124, 140, 245, 0.7)'; // 🔧 从0.5增加到0.7，更明显
    this.ctx.lineWidth = 2.5; // 🔧 从2增加到2.5，更粗
    this.ctx.setLineDash([10, 6]); // 🔧 从[8,4]改为[10,6]，虚线更长
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /**
   * 绘制序号标签（Sequential）
   */
  private drawSequenceNumber(pos: Point, number: number) {
    const radius = 12;

    // 圆形背景
    this.ctx.fillStyle = '#7C8CF5';
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
    this.ctx.fill();

    // 序号文字
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 11px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(String(number), pos.x, pos.y);
  }

  /**
   * 绘制辩论轮次标签（Debate）
   */
  private drawDebateRoundLabel(pos: Point, round: number) {
    const padding = 6;
    const text = `R${round + 1}`;

    this.ctx.font = 'bold 10px monospace';
    const textWidth = this.ctx.measureText(text).width;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = 18;

    // 背景
    this.ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
    this.ctx.beginPath();
    this.roundRect(pos.x - bgWidth / 2, pos.y - bgHeight / 2, bgWidth, bgHeight, 4);
    this.ctx.fill();

    // 文字
    this.ctx.fillStyle = '#fff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, pos.x, pos.y);
  }

  // ─── 区域2：思考气泡 ────────────────────────────────────────

  /**
   * 🔧 统一绘制所有思考气泡（在最上层，避免被团队边界遮挡）
   */
  private drawAllThinkingBubbles() {
    if (!this.state) return;

    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainRadius = this.layoutEngine.getMainAgentRadius();

    // 主 Agent 的思考气泡
    const mainThinkText = this.state.mainAgent.thinkingText;
    if (mainThinkText) {
      this.drawThinkingBubble(mainPos, mainRadius, mainThinkText);
    }

    // 子 Agent 的思考气泡（尊重出场动画 alpha）
    const visibleAgents = this.state.subAgents.filter(a => {
      const isTeamPlaceholder = a.status === 'idle' && a.multiAgent?.type === 'agent_team';
      return (a.status !== 'idle' || isTeamPlaceholder) && this.getAgentAlpha(a.id) > 0.01;
    });
    visibleAgents.forEach((agent, index) => {
      const pos = this.layoutEngine.getStableAgentPosition(agent, this.treePositions, index, visibleAgents.length);
      const radius = this.layoutEngine.getSubAgentRadius();
      const alpha = this.getAgentAlpha(agent.id);

      if (agent.thinkingText) {
        this.ctx.save();
        this.ctx.globalAlpha = alpha;

        // 思考流入前显示任务文本（紫色调），思考流入后显示思考内容（蓝色调）
        const isTaskText = agent.thinkingText === agent.task;

        // 团队并行模式下优先上方位置（避免与左侧邻居的工具堆栈重叠）
        const isTeamParallel = agent.multiAgent?.type === 'agent_team' &&
          (agent.multiAgent?.strategy === 'parallel' || agent.multiAgent?.strategy === 'debate');
        this.drawThinkingBubble(pos, radius, agent.thinkingText, isTaskText, isTeamParallel);

        this.ctx.restore();
      }
    });
  }

  /**
   * 绘制思考气泡（节点正上方）
   * @param isTaskText 显示任务文本（紫色调），否则为思考内容（蓝色调）
   */
  private drawThinkingBubble(agentPos: Point, agentRadius: number, text: string, isTaskText: boolean = false, preferTop: boolean = false) {
    const maxWidth = 220;
    const minWidth = 100;
    const padding = 12;
    const lineHeight = 16;
    const maxLines = 5;

    this.ctx.font = '11px sans-serif';
    const allLines = this.wrapText(text, maxWidth - padding * 2, 999);
    const displayLines = allLines.slice(-maxLines);

    // 自适应气泡尺寸：根据实际文本宽度和行数计算
    const maxLineWidth = Math.max(...displayLines.map(l => this.ctx.measureText(l).width));
    const bubbleWidth = Math.max(minWidth, Math.min(maxWidth, Math.ceil(maxLineWidth) + padding * 2 + 8));
    const bubbleHeight = displayLines.length * lineHeight + padding * 2;

    const bubblePos = this.layoutEngine.getThinkingBubblePosition(
      agentPos, agentRadius, bubbleWidth, bubbleHeight, preferTop,
    );

    // 背景色：任务文本用紫色调，思考文本用天蓝色调
    const bgFill = isTaskText ? 'rgba(139,92,246,0.2)' : 'rgba(96,165,250,0.13)';
    const bgStroke = isTaskText ? 'rgba(139,92,246,0.65)' : 'rgba(96,165,250,0.55)';

    this.ctx.fillStyle = bgFill;
    this.ctx.strokeStyle = bgStroke;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundRect(bubblePos.x, bubblePos.y, bubbleWidth, bubbleHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();

    // 小三角尾巴
    this.ctx.fillStyle = bgFill;
    this.ctx.strokeStyle = bgStroke;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    // 计算气泡中心点
    const bubbleCenterX = bubblePos.x + bubbleWidth / 2;
    const bubbleCenterY = bubblePos.y + bubbleHeight / 2;

    // 计算从气泡中心到 agent 中心的向量
    const dx = agentPos.x - bubbleCenterX;
    const dy = agentPos.y - bubbleCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // 归一化方向向量
      const dirX = dx / distance;
      const dirY = dy / distance;

      // 找到气泡边缘上最接近 agent 的点
      let tailX: number, tailY: number;

      // 判断主要方向（水平 vs 垂直）
      if (Math.abs(dirX) > Math.abs(dirY)) {
        // 主要是水平方向
        if (dirX > 0) {
          // agent 在气泡右侧
          tailX = bubblePos.x + bubbleWidth;
          tailY = Math.max(bubblePos.y + 10, Math.min(bubblePos.y + bubbleHeight - 10, agentPos.y));
        } else {
          // agent 在气泡左侧
          tailX = bubblePos.x;
          tailY = Math.max(bubblePos.y + 10, Math.min(bubblePos.y + bubbleHeight - 10, agentPos.y));
        }
      } else {
        // 主要是垂直方向
        if (dirY > 0) {
          // agent 在气泡下方
          tailX = Math.max(bubblePos.x + 10, Math.min(bubblePos.x + bubbleWidth - 10, agentPos.x));
          tailY = bubblePos.y + bubbleHeight;
        } else {
          // agent 在气泡上方
          tailX = Math.max(bubblePos.x + 10, Math.min(bubblePos.x + bubbleWidth - 10, agentPos.x));
          tailY = bubblePos.y;
        }
      }

      // 绘制三角形尾巴（指向 agent）
      const tailSize = 8;
      const perpX = -dirY; // 垂直于方向向量
      const perpY = dirX;

      this.ctx.moveTo(tailX + perpX * tailSize * 0.5, tailY + perpY * tailSize * 0.5);
      this.ctx.lineTo(tailX - perpX * tailSize * 0.5, tailY - perpY * tailSize * 0.5);
      this.ctx.lineTo(tailX + dirX * tailSize, tailY + dirY * tailSize);
    }

    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // 🔧 绘制文本（使用 displayLines，实现向上滚动效果）
    this.ctx.fillStyle = '#C4CAFF';
    this.ctx.font = '11px sans-serif';
    this.ctx.textAlign = 'left';
    displayLines.forEach((line, i) => {
      this.ctx.fillText(line, bubblePos.x + padding, bubblePos.y + padding + (i + 1) * lineHeight - 3);
    });
  }

  // ─── 区域3：右侧动作标签 ────────────────────────────────────

  /**
   * 绘制右侧动作标签（胶囊形，支持多行文本）
   */
  private drawMomentTag(agentPos: Point, agentRadius: number, moment: AgentMoment) {
    const padding = { x: 8, y: 5 };
    const iconWidth = 16;
    const lineHeight = 14;
    const labelDurationGap = 14; // 标签文案与耗时之间的间距，防止重叠

    // 支持多行文本（用 \n 分隔）
    const lines = moment.label.split('\n');

    this.ctx.font = '11px sans-serif';
    const maxLineWidth = Math.max(...lines.map(line => this.ctx.measureText(line).width));

    // 耗时文本（右侧独立区域，与标签文案之间用 labelDurationGap 分隔）
    let durationText = '';
    if (moment.status === 'running') {
      const elapsed = Math.max(0, moment.durationMs);
      durationText = `↻${(elapsed / 1000).toFixed(1)}s`;
    } else if (moment.status === 'success') {
      durationText = `✓${(moment.durationMs / 1000).toFixed(1)}s`;
    } else if (moment.status === 'error') {
      const elapsed = Math.max(0, moment.durationMs);
      durationText = elapsed > 0 ? `✗${(elapsed / 1000).toFixed(1)}s` : '✗';
    }

    this.ctx.font = '10px monospace';
    const durationTextWidth = durationText ? this.ctx.measureText(durationText).width : 0;
    // 耗时区域宽度：文本宽度 + 两侧留白
    const durationAreaWidth = durationText ? durationTextWidth + padding.x : 0;

    // tag 宽度 = 左padding + icon + label + gap + 耗时区域 + 右padding
    const tagWidth = padding.x + iconWidth + maxLineWidth + labelDurationGap + durationAreaWidth + padding.x;
    const tagHeight = Math.max(24, lines.length * lineHeight + padding.y * 2);

    // 传入实际尺寸，让 LayoutEngine 做碰撞避让
    const tagPos = this.layoutEngine.getMomentTagPosition(agentPos, agentRadius, tagWidth, tagHeight);

    // 背景色按类型
    const bgColor = this.getMomentBgColor(moment.type, moment.status);

    this.ctx.fillStyle = bgColor;
    this.ctx.beginPath();
    this.roundRect(tagPos.x, tagPos.y, tagWidth, tagHeight, 12);
    this.ctx.fill();

    // 图标（垂直居中）
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(moment.icon, tagPos.x + padding.x, tagPos.y + tagHeight / 2);

    // 标签文字（多行，左对齐）
    this.ctx.font = '11px sans-serif';
    const textStartY = tagPos.y + padding.y + lineHeight / 2;
    lines.forEach((line, i) => {
      this.ctx.fillText(
        line,
        tagPos.x + padding.x + iconWidth,
        textStartY + i * lineHeight
      );
    });

    // 耗时文本（右对齐，与标签文案之间保证 labelDurationGap 间距）
    if (durationText) {
      this.ctx.font = '10px monospace';
      this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(durationText, tagPos.x + tagWidth - padding.x, tagPos.y + tagHeight / 2);
    }

    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
  }

  private getMomentBgColor(type: string, status: string): string {
    if (status === 'error') return 'rgba(239,68,68,0.85)';
    const map: Record<string, string> = {
      idle: 'rgba(75,85,99,0.6)',
      file: 'rgba(59,130,246,0.8)',
      bash: 'rgba(75,85,99,0.9)',
      skill: 'rgba(139,92,246,0.8)',
      memory_read: 'rgba(16,185,129,0.8)',
      memory_write: 'rgba(16,185,129,0.8)',
      thinking: 'rgba(124,140,245,0.6)',
      writing: 'rgba(52,211,153,0.8)',
      reporting: 'rgba(59,130,246,0.8)',
    };
    return map[type] || 'rgba(75,85,99,0.8)';
  }

  // ─── 右侧工具调用堆栈 ─────────────────────────────────────────

  /**
   * 绘制工具调用堆栈（节点右侧，垂直排列，最多 4 个）
   * 🔧 显示正在运行和最近完成的工具（成功/失败），完成后短暂保留再消失
   */
  private drawToolCallStack(
    agentPos: Point,
    agentRadius: number,
    events: TimelineEvent[],
    currentTime: number
  ) {
    const gap = 8;
    const itemHeight = 26;
    const itemSpacing = 4;
    const maxVisible = 4;

    // 显示正在运行的工具 + 最近完成的工具（1秒内自动消失）
    const recentThreshold = 1000;
    const visibleEvents = events.filter(evt => {
      if (evt.status === 'running') return true;
      // 已完成的工具：如果在 3 秒内完成，则显示
      if ((evt.status === 'success' || evt.status === 'error') && evt.startTime) {
        const elapsed = currentTime - evt.startTime;
        return elapsed < recentThreshold;
      }
      return false;
    });

    // 获取最近的工具（最多 4 个）
    const displayEvents = visibleEvents.slice(-maxVisible);
    const hiddenCount = Math.max(0, visibleEvents.length - maxVisible);

    if (displayEvents.length === 0) return;

    // 如果有隐藏的工具，先绘制省略号
    if (hiddenCount > 0) {
      this.drawEllipsisIndicator(agentPos, agentRadius, gap, itemHeight, hiddenCount);
    }

    // 🔧 从 agent 图标顶部开始向下排列
    const startY = agentPos.y - agentRadius; // agent 顶部

    // 🔧 注册工具堆栈的占用区域（用于碰撞避让）
    const stackHeight = (displayEvents.length + (hiddenCount > 0 ? 1 : 0)) * (itemHeight + itemSpacing);
    const stackWidth = 200; // 估算宽度
    this.layoutEngine.addOccupied({
      x: agentPos.x + agentRadius + gap,
      y: startY,
      width: stackWidth,
      height: stackHeight,
    });

    // 按并行组分组连续的事件
    const parallelGroups: TimelineEvent[][] = [];
    let currentGroup: TimelineEvent[] = [];
    for (let i = 0; i < displayEvents.length; i++) {
      const evt = displayEvents[i];
      const prev = i > 0 ? displayEvents[i - 1] : null;
      if (prev && evt.parallelGroupId && prev.parallelGroupId === evt.parallelGroupId) {
        currentGroup.push(evt);
      } else {
        if (currentGroup.length > 0) parallelGroups.push(currentGroup);
        currentGroup = [evt];
      }
    }
    if (currentGroup.length > 0) parallelGroups.push(currentGroup);

    // 绘制工具（组内并排标记，组间纵向排列）
    let groupOffsetY = 0;
    const hiddenOffset = hiddenCount > 0 ? itemHeight + itemSpacing : 0;
    parallelGroups.forEach((group) => {
      const isParallel = group.length > 1;
      const yBase = startY + hiddenOffset + groupOffsetY;

      // 并行组：绘制左侧并行标识符 ∥
      if (isParallel) {
        const indicatorX = agentPos.x + agentRadius + gap - 14;
        const groupTop = yBase;
        const groupBottom = yBase + (group.length - 1) * (itemHeight + itemSpacing) + itemHeight;
        const groupMidY = (groupTop + groupBottom) / 2;

        // 竖线连接
        this.ctx.strokeStyle = 'rgba(124, 140, 245, 0.5)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(indicatorX + 6, groupTop + itemHeight / 2);
        this.ctx.lineTo(indicatorX + 6, groupBottom - itemHeight / 2);
        this.ctx.stroke();

        // 并行符号 ∥
        this.ctx.fillStyle = 'rgba(124, 140, 245, 0.8)';
        this.ctx.font = '10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('∥', indicatorX + 6, groupMidY);
        this.ctx.textAlign = 'left';
      }

      group.forEach((evt, idx) => {
        const verticalOffset = groupOffsetY + idx * (itemHeight + itemSpacing);
        this.drawToolCallItem(agentPos, agentRadius, evt, verticalOffset, gap, itemHeight, startY, currentTime);
      });

      groupOffsetY += group.length * (itemHeight + itemSpacing);
    });
  }

  /**
   * 绘制省略号指示器（表示有隐藏的工具）
   */
  private drawEllipsisIndicator(
    agentPos: Point,
    agentRadius: number,
    gap: number,
    itemHeight: number,
    hiddenCount: number
  ) {
    const tagPos = {
      x: agentPos.x + agentRadius + gap,
      y: agentPos.y - (itemHeight / 2)
    };

    const tagWidth = 80;

    // 背景
    this.ctx.fillStyle = 'rgba(58, 58, 58, 0.9)'; // bg-tertiary
    this.ctx.beginPath();
    this.roundRect(tagPos.x, tagPos.y, tagWidth, itemHeight, 4);
    this.ctx.fill();

    // 文本
    this.ctx.fillStyle = '#8A8A8A'; // text-secondary
    this.ctx.font = '11px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`... +${hiddenCount} more`, tagPos.x + 8, tagPos.y + itemHeight / 2);
  }

  /** 格式化工具名：write_file → Write File */
  private formatToolName(name: string): string {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * 绘制单个工具调用项（右侧，从 agent 顶部开始向下排列）
   */
  private drawToolCallItem(
    agentPos: Point,
    agentRadius: number,
    event: TimelineEvent,
    verticalOffset: number,
    gap: number,
    itemHeight: number,
    startY: number,
    currentTime: number
  ) {
    const padding = { x: 8, y: 5 };
    const iconWidth = 16;

    const displayLabel = this.formatToolName(event.label);

    this.ctx.font = '11px sans-serif';
    const labelWidth = this.ctx.measureText(displayLabel).width;
    const tagWidth = iconWidth + labelWidth + padding.x * 3 + 45; // +45 为计时区域预留

    // 🔧 从 agent 顶部开始向下排列
    const tagPos = {
      x: agentPos.x + agentRadius + gap,
      y: startY + verticalOffset
    };

    // 🔧 背景色按状态显示
    this.ctx.fillStyle = this.getToolCallBgColor(event.status);
    this.ctx.beginPath();
    this.roundRect(tagPos.x, tagPos.y, tagWidth, itemHeight, itemHeight / 2);
    this.ctx.fill();

    // 图标
    this.ctx.font = '12px sans-serif';
    this.ctx.fillStyle = '#fff';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(event.icon, tagPos.x + padding.x, tagPos.y + itemHeight / 2);

    // 工具名称
    this.ctx.font = '11px sans-serif';
    this.ctx.fillText(displayLabel, tagPos.x + padding.x + iconWidth, tagPos.y + itemHeight / 2);

    // ✅ 右侧显示计时或状态
    let timeText = '';
    if (event.status === 'running' && event.startTime) {
      const elapsed = currentTime - event.startTime;
      timeText = `${Math.max(0, elapsed / 1000).toFixed(1)}s`;
    } else if (event.status === 'success') {
      const dur = event.duration || (event.startTime && event.endTime ? event.endTime - event.startTime : 0);
      timeText = dur > 0 ? `✓${(dur / 1000).toFixed(1)}s` : '✓';
    } else if (event.status === 'error') {
      const dur = event.duration || (event.startTime && event.endTime ? event.endTime - event.startTime : 0);
      timeText = dur > 0 ? `✗${(dur / 1000).toFixed(1)}s` : '✗';
    }

    if (timeText) {
      this.ctx.font = '10px monospace';
      this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(timeText, tagPos.x + tagWidth - padding.x, tagPos.y + itemHeight / 2);
    }

    // 重置文本对齐
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
  }

  /**
   * 🔧 根据工具调用状态返回背景色
   */
  private getToolCallBgColor(status: string): string {
    switch (status) {
      case 'running':
        return 'rgba(59,130,246,0.8)'; // 蓝色 - 运行中
      case 'success':
        return 'rgba(52,211,153,0.8)'; // 绿色 - 成功
      case 'error':
        return 'rgba(239,68,68,0.85)'; // 红色 - 失败
      default:
        return 'rgba(75,85,99,0.8)'; // 灰色 - 默认
    }
  }

  // ─── 连线中点标签 ────────────────────────────────────────────

  /**
   * 绘制连线中点标签
   */
  private drawConnectionLabel(from: Point, to: Point, text: string, opacity: number) {
    const labelPos = this.layoutEngine.getConnectionLabelPosition(from, to);
    const padding = { x: 6, y: 3 };
    this.ctx.font = '10px sans-serif';
    const textWidth = this.ctx.measureText(text).width;
    const labelWidth = textWidth + padding.x * 2;
    const labelHeight = 18;

    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = 'rgba(45,45,45,0.9)';
    this.ctx.strokeStyle = 'rgba(124,140,245,0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundRect(
      labelPos.x - labelWidth / 2,
      labelPos.y - labelHeight / 2,
      labelWidth,
      labelHeight,
      4
    );
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.fillStyle = '#C4CAFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, labelPos.x, labelPos.y);
    this.ctx.globalAlpha = 1;
    this.ctx.textBaseline = 'alphabetic';
  }

  // ─── 文本辅助 ────────────────────────────────────────────────

  /** 自动换行（优化版：用平均字符宽度估算断点，减少 measureText 调用 + 缓存） */
  private wrapText(text: string, maxWidth: number, maxLines: number): string[] {
    const cacheKey = `${text}|${maxWidth}|${maxLines}`;
    const cached = this.wrapCache.get(cacheKey);
    if (cached) return cached;

    const lines: string[] = [];
    let remaining = text;

    for (let lineIdx = 0; lineIdx < maxLines && remaining.length > 0; lineIdx++) {
      // 快速路径：整个剩余文本适合一行
      if (this.ctx.measureText(remaining).width <= maxWidth) {
        lines.push(remaining);
        if (this.wrapCache.size > 500) { this.wrapCache.clear(); } else { this.wrapCache.set(cacheKey, lines); }
        return lines;
      }

      // 用平均字符宽度估算断点位置
      const avgWidth = this.ctx.measureText(remaining).width / remaining.length;
      let breakIdx = Math.floor(maxWidth / avgWidth);
      breakIdx = Math.max(1, Math.min(breakIdx, remaining.length - 1));

      // 微调：向前移动直到适合宽度
      while (breakIdx > 0 && this.ctx.measureText(remaining.slice(0, breakIdx)).width > maxWidth) {
        breakIdx--;
      }
      if (breakIdx === 0) breakIdx = 1; // 至少一个字符

      // 最后一行加省略号
      if (lineIdx === maxLines - 1 && breakIdx < remaining.length) {
        let truncated = remaining.slice(0, breakIdx);
        while (truncated.length > 1 && this.ctx.measureText(truncated + '…').width > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        lines.push(truncated + '…');
        if (this.wrapCache.size > 500) { this.wrapCache.clear(); } else { this.wrapCache.set(cacheKey, lines); }
        return lines;
      }

      lines.push(remaining.slice(0, breakIdx));
      remaining = remaining.slice(breakIdx);
    }
    // 缓存上限保护：超过 500 条则清理（流式文本变化时缓存会累积旧版本）
    if (this.wrapCache.size > 500) {
      this.wrapCache.clear();
    } else {
      this.wrapCache.set(cacheKey, lines);
    }
    return lines;
  }

  /** 截断文本到指定像素宽度 */
  private truncateText(text: string, maxWidth: number): string {
    if (this.ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && this.ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  /**
   * 绘制 Agent 类型标签
   */
  private drawAgentTypeLabel(agentPos: Point, agentRadius: number, agentType: 'builtin' | 'preset' | 'custom' | 'temporary', durationOffset: number = 0) {
    const labelConfig = {
      builtin: { text: '系统', color: 'rgba(59, 130, 246, 0.9)', icon: '⚡' }, // blue - 系统内置
      preset: { text: '应用', color: 'rgba(52, 211, 153, 0.9)', icon: '📦' }, // green - 应用级 agent
      custom: { text: '自定义', color: 'rgba(168, 85, 247, 0.9)', icon: '✨' }, // purple - 用户自定义
      temporary: { text: '临时', color: 'rgba(156, 163, 175, 0.9)', icon: '⏱' }, // gray - 临时 agent
    };

    const config = labelConfig[agentType] || labelConfig.builtin;
    const labelWidth = 60;
    const labelHeight = 20;
    const labelX = agentPos.x - labelWidth / 2;
    const labelY = agentPos.y + agentRadius + 28 + durationOffset; // 在名称/耗时下方

    // 背景
    this.ctx.fillStyle = config.color;
    this.ctx.beginPath();
    this.roundRect(labelX, labelY, labelWidth, labelHeight, 4);
    this.ctx.fill();

    // 文本
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`${config.icon} ${config.text}`, agentPos.x, labelY + labelHeight / 2);
  }

  /**
   * 绘制 Leader 徽章（Hierarchical 策略）
   */
  private drawLeaderBadge(agentPos: Point, agentRadius: number) {
    const badgeSize = 20;
    const badgeX = agentPos.x + agentRadius - badgeSize / 2;
    const badgeY = agentPos.y - agentRadius - badgeSize / 2;

    // 圆形背景
    this.ctx.fillStyle = '#FBB024';
    this.ctx.beginPath();
    this.ctx.arc(badgeX, badgeY, badgeSize / 2, 0, 2 * Math.PI);
    this.ctx.fill();

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 皇冠图标
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('👑', badgeX, badgeY);
  }

  /**
   * 绘制步骤徽章（Sequential/Pipeline 策略）
   */
  private drawStepBadge(agentPos: Point, agentRadius: number, stepNumber: number) {
    const badgeSize = 18;
    const badgeX = agentPos.x + agentRadius - badgeSize / 2;
    const badgeY = agentPos.y - agentRadius - badgeSize / 2;

    // 圆形背景
    this.ctx.fillStyle = '#7C8CF5';
    this.ctx.beginPath();
    this.ctx.arc(badgeX, badgeY, badgeSize / 2, 0, 2 * Math.PI);
    this.ctx.fill();

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 序号
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 11px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(String(stepNumber), badgeX, badgeY);
  }

  /**
   * 绘制辩论角色徽章（Debate 策略）
   */
  private drawDebateRoleBadge(agentPos: Point, agentRadius: number, role: 'affirmative' | 'negative' | 'judge') {
    const badgeSize = 20;
    const badgeX = agentPos.x - agentRadius + badgeSize / 2;
    const badgeY = agentPos.y - agentRadius - badgeSize / 2;

    // 角色颜色和图标
    const roleConfig = {
      affirmative: { color: '#34D399', icon: '✓', label: '正' },
      negative: { color: '#EF4444', icon: '✗', label: '反' },
      judge: { color: '#F59E0B', icon: '⚖', label: '判' },
    };

    const config = roleConfig[role];

    // 圆形背景
    this.ctx.fillStyle = config.color;
    this.ctx.beginPath();
    this.ctx.arc(badgeX, badgeY, badgeSize / 2, 0, 2 * Math.PI);
    this.ctx.fill();

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 文字
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 11px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(config.label, badgeX, badgeY);
  }

  /**
   * 绘制辩论轮次徽章（Debate 策略）
   */
  private drawDebateRoundBadge(agentPos: Point, agentRadius: number, round: number) {
    const badgeSize = 18;
    const badgeX = agentPos.x + agentRadius - badgeSize / 2;
    const badgeY = agentPos.y - agentRadius - badgeSize / 2;

    // 圆形背景（绿色）
    this.ctx.fillStyle = '#34D399';
    this.ctx.beginPath();
    this.ctx.arc(badgeX, badgeY, badgeSize / 2, 0, 2 * Math.PI);
    this.ctx.fill();

    // 边框
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 轮次文字
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 10px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`R${round}`, badgeX, badgeY);
  }

  /**
   * 绘制进度环
   * - progress > 0: 显示固定进度弧线
   * - progress = 0: 显示不确定进度动画（旋转弧线）
   */
  private drawProgressRing(center: Point, radius: number, progress: number, currentTime: number = 0) {
    if (progress > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + 2 * Math.PI * progress;
      this.ctx.strokeStyle = '#34D399';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, radius + 5, startAngle, endAngle);
      this.ctx.stroke();
    } else {
      // 不确定进度：旋转的短弧线
      const rotation = (currentTime / 800) * 2 * Math.PI; // 每 800ms 转一圈
      const arcLength = Math.PI / 2; // 90° 弧线
      const startAngle = rotation;
      const endAngle = rotation + arcLength;
      this.ctx.strokeStyle = 'rgba(52, 211, 153, 0.6)';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, radius + 5, startAngle, endAngle);
      this.ctx.stroke();
    }
  }

  /**
   * 绘制 Agent 详情卡片
   */
  private drawAgentCard(agentPos: Point, agentRadius: number, agent: SubAgentData) {
    const cardWidth = 180;
    const cardHeight = 100;
    const cardX = agentPos.x + agentRadius + 15;
    const cardY = agentPos.y - cardHeight / 2;

    // 背景（使用璇玑的背景色）
    this.ctx.fillStyle = 'rgba(30, 30, 30, 0.95)'; // bg-primary with opacity
    this.ctx.strokeStyle = '#3A3A3A'; // bg-tertiary
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundRect(cardX, cardY, cardWidth, cardHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();

    // 标题
    this.ctx.fillStyle = '#E4E4E4'; // text-primary
    this.ctx.font = 'bold 14px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(agent.name, cardX + 10, cardY + 20);

    // 状态
    this.ctx.fillStyle = '#8A8A8A'; // text-secondary
    this.ctx.font = '12px sans-serif';
    this.ctx.fillText(`状态: ${this.getStatusLabel(agent.status)}`, cardX + 10, cardY + 40);

    // 耗时
    if (agent.duration !== undefined) {
      this.ctx.fillText(`耗时: ${agent.duration}ms`, cardX + 10, cardY + 58);
    }

    // Token
    if (agent.tokenUsage !== undefined) {
      this.ctx.fillText(`Token: ${agent.tokenUsage}`, cardX + 10, cardY + 76);
    }
  }

  /**
   * 获取 Agent 颜色（使用璇玑主题色）
   */
  private getAgentColor(status: AgentState | 'success' | 'running'): string {
    switch (status) {
      case 'thinking':
      case 'running':
        return '#5B6FD8'; // 蓝色
      case 'executing':
        return '#2BA76F'; // 绿色
      case 'waiting':
        return '#D4A017'; // 黄色
      case 'error':
        return '#D85B5B'; // 红色
      case 'done':
      case 'success':
        return '#2BA76F'; // 绿色（完成）
      default:
        return '#3A3A3A'; // bg-tertiary
    }
  }

  /**
   * 获取 Agent 边框颜色
   */
  private getAgentBorderColor(status: AgentState | 'success' | 'running'): string {
    switch (status) {
      case 'thinking':
      case 'running':
        return '#7C8CF5'; // primary
      case 'executing':
        return '#34D399'; // success
      case 'waiting':
        return '#FBBF24'; // warning
      case 'error':
        return '#F87171'; // error
      case 'done':
      case 'success':
        return '#34D399'; // success（完成）
      default:
        return '#8A8A8A'; // text-secondary
    }
  }

  /**
   * 获取子 Agent 颜色（使用璇玑主题色）
   */
  private getSubAgentColor(status: SubAgentState): string {
    switch (status) {
      case 'running':
        return '#5B6FD8'; // 蓝色（运行中）
      case 'thinking':
        return '#5B6FD8'; // 蓝色（思考中）
      case 'executing':
        return '#2BA76F'; // 绿色（执行中）
      case 'done':
        return '#2BA76F'; // 绿色（完成）
      case 'success':
        return '#2BA76F'; // 绿色（成功）
      case 'error':
        return '#D85B5B'; // 红色（失败）
      default:
        return '#3A3A3A'; // bg-tertiary（空闲）
    }
  }

  /**
   * 获取子 Agent 边框颜色（使用璇玑主题色）
   */
  private getSubAgentBorderColor(status: SubAgentState): string {
    switch (status) {
      case 'running':
        return '#7C8CF5'; // primary（运行中）
      case 'thinking':
        return '#7C8CF5'; // primary（思考中）
      case 'executing':
        return '#34D399'; // success（执行中）
      case 'done':
        return '#34D399'; // success（完成）
      case 'success':
        return '#34D399'; // success（成功）
      case 'error':
        return '#F87171'; // error（失败）
      default:
        return '#8A8A8A'; // text-secondary（空闲）
    }
  }

  /**
   * 获取工具图标
   */
  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      Read: '📄',
      Write: '✍️',
      Edit: '✏️',
      Bash: '💻',
      Grep: '🔍',
      Glob: '🗂️',
      Agent: '🤖',
    };

    return iconMap[toolName] || toolName.charAt(0).toUpperCase();
  }

  /**
   * 获取状态标签
   */
  private getStatusLabel(status: SubAgentState): string {
    switch (status) {
      case 'running':
        return '运行中';
      case 'thinking':
        return '思考中';
      case 'executing':
        return '执行中';
      case 'done':
        return '完成';
      case 'success':
        return '成功';
      case 'error':
        return '失败';
      default:
        return '空闲';
    }
  }

  /**
   * 设置悬停的 Agent
   */
  setHoveredAgent(agentId: string | null) {
    this.hoveredAgent = agentId;
  }

  /** 获取 OffscreenCanvas（Worker 用于生成 ImageBitmap） */
  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }

  /** 获取当前视图缩放比例 */
  getViewScale(): number {
    return this.viewScale;
  }

  /**
   * 销毁
   */
  destroy() {
    this.animationEngine.clear();
  }
}
