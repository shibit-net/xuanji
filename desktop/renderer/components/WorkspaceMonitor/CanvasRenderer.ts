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
  MomentType,
  HistoryDot,
  TimelineEvent,
  RecentEvent,
} from './types';
import { LayoutEngine } from './LayoutEngine';
import { AnimationEngine } from './AnimationEngine';

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layoutEngine: LayoutEngine;
  private animationEngine: AnimationEngine;
  private animationFrame: number | null = null;
  private lastFrameTime: number = 0;
  private state: WorkspaceState | null = null;
  private hoveredAgent: string | null = null;
  /** 树形布局：agent ID → 位置映射 */
  private treePositions: Map<string, Point> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法获取 Canvas 2D 上下文');
    }
    this.ctx = ctx;

    // 初始化引擎
    this.layoutEngine = new LayoutEngine(canvas.width, canvas.height);
    this.animationEngine = new AnimationEngine(this.layoutEngine);

    // 设置高 DPI 支持
    this.setupHighDPI();
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

  /**
   * 设置高 DPI 支持
   */
  private setupHighDPI() {
    const dpr = window.devicePixelRatio || 1;
    // 从父容器获取尺寸，而不是从 canvas 自身
    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.scale(dpr, dpr);

    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.layoutEngine.updateSize(rect.width, rect.height);
  }

  /**
   * 更新状态
   */
  updateState(state: WorkspaceState) {
    this.state = state;
    // 🔧 立即计算树形布局位置，确保团队边界框能在第一帧就正确显示
    if (this.state.subAgents.length > 0) {
      this.treePositions = this.layoutEngine.computeTreePositions(this.state.subAgents);
    }
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
   * 更新动画（根据状态）
   */
  private updateAnimations() {
    if (!this.state) return;

    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainRadius = this.layoutEngine.getMainAgentRadius();

    // 清理旧动画
    this.animationEngine.clear();

    // 根据主 Agent 状态创建动画
    switch (this.state.mainAgent.status) {
      case 'thinking':
        this.animationEngine.register(
          this.animationEngine.createPulseAnimation('main', mainPos, mainRadius)
        );
        break;
      case 'executing':
        this.animationEngine.register(
          this.animationEngine.createRotateAnimation('main', mainPos, mainRadius)
        );
        break;
      case 'waiting':
        this.animationEngine.register(
          this.animationEngine.createBlinkAnimation('main', mainPos, mainRadius)
        );
        break;
      case 'error':
        this.animationEngine.register(
          this.animationEngine.createShakeAnimation('main', mainPos, 500)
        );
        break;
    }

    // 为活跃的协作关系创建粒子流动动画
    this.state.collaborations.forEach((collab) => {
      if (collab.active) {
        const fromPos = this.getAgentPosition(collab.from);
        const toPos = this.getAgentPosition(collab.to);
        if (fromPos && toPos) {
          const path = this.layoutEngine.getConnectionPath(fromPos, toPos);
          const color = collab.type === 'task' ? '#34D399' : '#7C8CF5'; // success : primary
          this.animationEngine.register(
            this.animationEngine.createParticleFlowAnimation(
              `${collab.from}-${collab.to}`,
              path,
              color,
              3
            )
          );
        }
      }
    });
  }

  /**
   * 获取 Agent 位置
   */
  private getAgentPosition(agentId: string): Point | null {
    if (!this.state) return null;

    if (agentId === this.state.mainAgent.id) {
      return this.layoutEngine.getMainAgentPosition();
    }

    // 优先使用树形布局位置
    const treePos = this.treePositions.get(agentId);
    if (treePos) return treePos;

    return null;
  }

  /**
   * 开始渲染循环
   */
  start() {
    if (this.animationFrame !== null) return;

    this.lastFrameTime = performance.now();
    this.renderLoop();
  }

  /**
   * 停止渲染循环
   */
  stop() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * 渲染循环
   */
  private renderLoop = () => {
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // 更新动画
    this.animationEngine.update(currentTime, deltaTime);

    // 清空画布
    this.clear();

    // 绘制内容
    if (this.state) {
      // 每帧重置碰撞检测
      this.layoutEngine.resetOccupied();

      // 计算树形布局位置
      this.treePositions = this.layoutEngine.computeTreePositions(this.state.subAgents);

      // 预注册所有节点的占用区域
      this.registerNodeOccupiedAreas();

      // 🔧 绘制顺序优化：思考气泡单独绘制在最上层
      // 绘制团队边界框（在节点和连接线之前）
      this.drawTeamBoundaries();

      this.drawConnections();
      this.drawSubAgents();
      this.drawMainAgent();

      // 🔧 最后绘制思考气泡，确保在最上层且不被团队边界遮挡
      this.drawAllThinkingBubbles();
      // ★ 统计信息已移至组件底部，不再在 Canvas 中绘制 ★
      // this.drawStats();
      // ★ 移除底部事件列表：工具调用历史不应该在 workspace 中展示 ★
      // this.drawEventFeed(this.state.recentEvents);
    } else {
      this.drawEmptyState();
    }

    // 绘制动画
    this.animationEngine.draw(this.ctx);

    // 继续循环
    this.animationFrame = requestAnimationFrame(this.renderLoop);
  };

  /**
   * 清空画布
   */
  private clear() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    // 绘制背景（使用璇玑的背景色）
    this.ctx.fillStyle = '#2D2D2D'; // bg-secondary
    this.ctx.fillRect(0, 0, rect.width, rect.height);
  }

  /**
   * 绘制空状态
   */
  private drawEmptyState() {
    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // 绘制图标
    this.ctx.fillStyle = '#8A8A8A'; // text-secondary
    this.ctx.font = '48px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🤖', centerX, centerY - 20);

    // 绘制文本
    this.ctx.fillStyle = '#8A8A8A'; // text-secondary
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText('Agent 空闲中', centerX, centerY + 30);
  }

  /**
   * 预注册所有节点的占用区域（圆形节点 + 名称标签 + 安全边距）
   */
  private registerNodeOccupiedAreas() {
    if (!this.state) return;
    const safeGap = 30; // 🔧 增大安全边距，确保气泡不会遮挡其他节点

    // 主 Agent 节点
    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainR = this.layoutEngine.getMainAgentRadius();
    this.layoutEngine.addOccupied({
      x: mainPos.x - mainR - safeGap,
      y: mainPos.y - mainR - safeGap,
      width: (mainR + safeGap) * 2,
      height: (mainR + safeGap) * 2 + 30,
    });

    // 子 Agent 节点（使用树形位置）
    this.state.subAgents.forEach((agent) => {
      const pos = this.treePositions.get(agent.id);
      if (!pos) return;
      const r = this.layoutEngine.getSubAgentRadius();
      this.layoutEngine.addOccupied({
        x: pos.x - r - safeGap,
        y: pos.y - r - safeGap,
        width: (r + safeGap) * 2,
        height: (r + safeGap) * 2 + 25,
      });
    });

    // 🔧 团队边界框标题（避免气泡遮挡团队名称）
    if (this.state.teamBoundaries) {
      this.state.teamBoundaries.forEach((team) => {
        if (!team.bounds) return;
        const { x, y } = team.bounds;
        const titleHeight = 28;
        const titleWidth = 200; // 预估标题宽度

        this.layoutEngine.addOccupied({
          x: x + 8,
          y: y,
          width: titleWidth,
          height: titleHeight,
        });
      });
    }
  }

  /**
   * 绘制主 Agent
   */
  private drawMainAgent() {
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

    // 绘制图标（优先使用 roleIcon）
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '32px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(agent.roleIcon || '🤖', pos.x, pos.y - 2);

    // 绘制名称
    this.ctx.fillStyle = '#E4E4E4';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText(agent.name, pos.x, pos.y + radius + 20);

    // 🔧 思考气泡已移至 drawAllThinkingBubbles() 统一绘制，确保在最上层

    // 区域3：右侧工具调用堆栈
    const hasTimelineEvents = agent.timelineEvents && agent.timelineEvents.length > 0;
    if (hasTimelineEvents) {
      const recent5 = agent.timelineEvents.slice(-5);
      this.drawToolCallStack(pos, radius, recent5);
    }

    // 🔧 currentMoment 现在只用于后台操作（如compress）
    // 如果有 timelineEvents，currentMoment 会通过碰撞避让自动放在合适的位置
    if (agent.currentMoment) {
      this.drawMomentTag(pos, radius, agent.currentMoment);
    }
  }

  /**
   * 绘制子 Agent
   * 非团队成员：只显示正在运行的 Agent
   * 团队成员：始终显示（跟随团队边界框一起出现/消失）
   */
  private drawSubAgents() {
    if (!this.state) return;

    // 🔧 团队成员始终显示，非团队成员只显示运行中的
    const visibleAgents = this.state.subAgents.filter(
      agent => agent.multiAgent?.teamName || (agent.status !== 'success' && agent.status !== 'error')
    );

    visibleAgents.forEach((agent, index) => {
      // 使用树形布局位置
      const pos = this.treePositions.get(agent.id)
        || this.layoutEngine.getSubAgentPosition(index, visibleAgents.length);
      const radius = this.layoutEngine.getSubAgentRadius();

      // 🔧 辩论模式特殊处理
      const isDebateAgent = agent.multiAgent?.strategy === 'debate';
      const isCurrentSpeaker = isDebateAgent && agent.status === 'running';
      const isRunning = agent.status === 'running';

      // 绘制圆形背景
      this.ctx.fillStyle = this.getSubAgentColor(agent.status);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      this.ctx.fill();

      // 🔧 绘制边框（running 状态使用高亮边框）
      if (isCurrentSpeaker) {
        // 辩论模式当前发言者：绿色高亮边框
        this.ctx.strokeStyle = 'rgba(52, 211, 153, 1)';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();

        // 添加外发光效果
        this.ctx.shadowColor = 'rgba(52, 211, 153, 0.6)';
        this.ctx.shadowBlur = 15;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      } else if (isRunning) {
        // 普通 running 状态：蓝色高亮边框
        this.ctx.strokeStyle = 'rgba(124, 140, 245, 1)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        // 添加脉动效果（使用动画时间）
        const pulseIntensity = Math.sin(Date.now() / 500) * 0.3 + 0.7; // 0.4 - 1.0
        this.ctx.shadowColor = `rgba(124, 140, 245, ${pulseIntensity})`;
        this.ctx.shadowBlur = 12;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      } else {
        // 普通边框
        this.ctx.strokeStyle = this.getSubAgentBorderColor(agent.status);
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }

      // 绘制图标（优先使用 roleIcon）
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '20px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      const icon = agent.roleIcon || this.getToolIcon(agent.name);
      this.ctx.fillText(icon, pos.x, pos.y - 1);

      // 🔧 绘制名称（辩论模式显示角色标签）
      if (isDebateAgent && agent.multiAgent?.debateRole) {
        // 辩论模式：显示角色 + 名称
        const roleLabels = {
          affirmative: '正方',
          negative: '反方',
          judge: '裁判',
        };
        const roleLabel = roleLabels[agent.multiAgent.debateRole];

        // 🔧 检查 agent.name 是否已包含角色前缀，避免重复
        let displayName = agent.name;
        if (displayName.startsWith(roleLabel + '·')) {
          // 名称已包含角色前缀，直接使用
          displayName = agent.name;
        } else {
          // 名称不包含角色前缀，添加前缀
          displayName = `${roleLabel}·${agent.name}`;
        }

        // 角色标签颜色
        const roleColors = {
          affirmative: '#34D399', // 绿色
          negative: '#F87171',    // 红色
          judge: '#FBBF24',       // 黄色
        };

        this.ctx.fillStyle = roleColors[agent.multiAgent.debateRole];
        this.ctx.font = 'bold 12px sans-serif';
        this.ctx.fillText(displayName, pos.x, pos.y + radius + 15);
      } else {
        // 普通模式：只显示名称
        this.ctx.fillStyle = '#8A8A8A';
        this.ctx.font = '11px sans-serif';
        this.ctx.fillText(agent.name, pos.x, pos.y + radius + 15);
      }

      // 绘制耗时（如果有）
      if (agent.duration !== undefined && agent.duration > 0) {
        this.ctx.fillStyle = '#7C8CF5'; // primary color
        this.ctx.font = '10px monospace';
        const durationText = `${(agent.duration / 1000).toFixed(1)}s`;
        this.ctx.fillText(durationText, pos.x, pos.y + radius + 28);
      }

      // 绘制 Agent 类型标签
      if (agent.agentType) {
        this.drawAgentTypeLabel(pos, radius, agent.agentType);
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
        // 轮次徽章（右上角）
        if (agent.multiAgent.currentRound) {
          this.drawDebateRoundBadge(pos, radius, agent.multiAgent.currentRound);
        }
      }

      // 如果正在执行，绘制进度环
      if (agent.status === 'running' && agent.progress !== undefined) {
        this.drawProgressRing(pos, radius, agent.progress);
      }

      // 🔧 思考气泡已移至 drawAllThinkingBubbles() 统一绘制，确保在最上层

      // 区域3：右侧工具调用列表（最近 5 个）
      if (agent.timelineEvents && agent.timelineEvents.length > 0) {
        const recent5 = agent.timelineEvents.slice(-5);
        this.drawToolCallStack(pos, radius, recent5);
      }

      // 悬停时显示详情卡片
      if (this.hoveredAgent === agent.id) {
        this.drawAgentCard(pos, radius, agent);
      }
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

      // 策略图标映射
      const strategyIcons: Record<string, string> = {
        sequential: '📋',
        debate: '💬',
        hierarchical: '👑',
        pipeline: '🔗',
        parallel: '⚡',
      };

      // 策略颜色映射
      const strategyColors: Record<string, string> = {
        sequential: 'rgba(124, 140, 245, 0.2)',
        debate: 'rgba(52, 211, 153, 0.2)',
        hierarchical: 'rgba(251, 191, 36, 0.2)',
        pipeline: 'rgba(139, 92, 246, 0.2)',
        parallel: 'rgba(236, 72, 153, 0.2)',
      };

      const borderColors: Record<string, string> = {
        sequential: 'rgba(124, 140, 245, 0.6)',
        debate: 'rgba(52, 211, 153, 0.6)',
        hierarchical: 'rgba(251, 191, 36, 0.6)',
        pipeline: 'rgba(139, 92, 246, 0.6)',
        parallel: 'rgba(236, 72, 153, 0.6)',
      };

      // 🔧 团队标题高度（在虚线上方）
      const titleHeight = 32;

      // 绘制边界框背景（从 y + titleHeight 开始，为标题留出空间）
      this.ctx.fillStyle = strategyColors[team.strategy] || 'rgba(124, 140, 245, 0.1)';
      this.ctx.strokeStyle = borderColors[team.strategy] || 'rgba(124, 140, 245, 0.4)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 4]);
      this.ctx.beginPath();
      this.roundRect(x, y + titleHeight, width, height - titleHeight, 12);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // 🔧 绘制团队标题（在虚线上方，完全在边界框外）
      const titleBgHeight = 28;

      // 🔧 计算标题实际需要的宽度
      this.ctx.font = 'bold 12px sans-serif';
      const teamNameWidth = this.ctx.measureText(team.teamName).width;
      this.ctx.font = '10px sans-serif';
      const strategyLabel = team.strategy.charAt(0).toUpperCase() + team.strategy.slice(1);
      const strategyWidth = this.ctx.measureText(`(${strategyLabel})`).width;

      // 🔧 计算右侧额外内容宽度（Debate 轮次或 Parallel 状态）
      let rightContentWidth = 0;
      if (team.strategy === 'debate' && team.currentRound !== undefined && team.maxRounds !== undefined) {
        this.ctx.font = 'bold 11px monospace';
        rightContentWidth = this.ctx.measureText(`Round ${team.currentRound}/${team.maxRounds}`).width + 24; // 加上左右边距
      } else if (team.strategy === 'parallel') {
        const runningCount = team.memberIds.filter((memberId: string) => {
          const agent = this.state?.subAgents.find(a => a.id === memberId);
          return agent && agent.status === 'running';
        }).length;
        if (runningCount > 0) {
          this.ctx.font = 'bold 11px monospace';
          rightContentWidth = this.ctx.measureText(`⚡ ${runningCount}/${team.memberIds.length} Running`).width + 24;
        }
      }

      // 图标宽度(16) + 左边距(14) + 团队名称 + 间距(4) + 策略名称 + 右边距(14) + 右侧内容 + 额外空间(20)
      const calculatedWidth = 16 + 14 + teamNameWidth + 4 + strategyWidth + 14 + rightContentWidth + 20;
      const titleBgWidth = Math.min(Math.max(calculatedWidth, 150), width - 16); // 最小150px，最大不超过边界框

      // 🔧 如果团队名称过长，需要截断
      const maxTeamNameWidth = titleBgWidth - 16 - 14 - 4 - strategyWidth - 14 - rightContentWidth - 20;
      let displayTeamName = team.teamName;
      if (teamNameWidth > maxTeamNameWidth) {
        // 截断团队名称
        this.ctx.font = 'bold 12px sans-serif';
        while (this.ctx.measureText(displayTeamName + '…').width > maxTeamNameWidth && displayTeamName.length > 1) {
          displayTeamName = displayTeamName.slice(0, -1);
        }
        displayTeamName += '…';
      }

      this.ctx.fillStyle = borderColors[team.strategy] || 'rgba(124, 140, 245, 0.8)';
      this.ctx.beginPath();
      this.roundRect(x + 8, y, titleBgWidth, titleBgHeight, 6);
      this.ctx.fill();

      // 策略图标
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '16px sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      const icon = strategyIcons[team.strategy] || '👥';
      this.ctx.fillText(icon, x + 14, y + titleBgHeight / 2);

      // 团队名称（使用截断后的名称）
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.fillText(displayTeamName, x + 36, y + titleBgHeight / 2);

      // 🔧 测量截断后的团队名称宽度（使用正确的字体）
      const displayTeamNameWidth = this.ctx.measureText(displayTeamName).width;

      // 策略名称（小字）
      this.ctx.font = '10px sans-serif';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.fillText(`(${strategyLabel})`, x + 36 + displayTeamNameWidth + 4, y + titleBgHeight / 2);

      // Debate 策略：显示轮次
      if (team.strategy === 'debate' && team.currentRound !== undefined && team.maxRounds !== undefined) {
        this.ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
        this.ctx.font = 'bold 11px monospace';
        this.ctx.textAlign = 'right';
        this.ctx.fillText(`Round ${team.currentRound}/${team.maxRounds}`, x + width - 12, y + titleBgHeight / 2);
      }

      // 🔧 Parallel 策略：显示并行执行指示器
      if (team.strategy === 'parallel') {
        // 统计正在运行的成员数量
        const runningCount = team.memberIds.filter((memberId: string) => {
          const agent = this.state?.subAgents.find(a => a.id === memberId);
          return agent && agent.status === 'running';
        }).length;

        if (runningCount > 0) {
          this.ctx.fillStyle = 'rgba(236, 72, 153, 1)';
          this.ctx.font = 'bold 11px monospace';
          this.ctx.textAlign = 'right';
          this.ctx.fillText(`⚡ ${runningCount}/${team.memberIds.length} Running`, x + width - 12, y + titleBgHeight / 2);
        }
      }

      // 🔧 Debate 策略：绘制中心圆（辩论主题圆）
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
    const fromY = mainPos.y + mainRadius + 20; // 主 agent 底部（圆形半径 + 名称标签高度）

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

  /**
   * 绘制连接线（旧版本，保留向后兼容）
   */
  private drawConnectionsOld() {
    if (!this.state) return;

    try {
      this.state.collaborations.forEach((collab) => {
        const fromPos = this.getAgentPosition(collab.from);
        const toPos = this.getAgentPosition(collab.to);

        if (fromPos && toPos) {
          const path = this.layoutEngine.getConnectionPath(fromPos, toPos);

          if (!path.points || !Array.isArray(path.points) || path.points.length === 0) {
            return;
          }

          // 连线颜色语义
          let lineColor = '#3A3A3A';
          if (collab.active) {
            lineColor = collab.type === 'task' ? '#7C8CF5' : '#34D399';
          }

          this.ctx.strokeStyle = lineColor;
          this.ctx.lineWidth = collab.active ? 2 : 1;
          this.ctx.setLineDash(collab.type === 'data' ? [5, 5] : []);
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

  // ─── 区域2：思考气泡 ────────────────────────────────────────

  /**
   * 🔧 统一绘制所有思考气泡（在最上层，避免被团队边界遮挡）
   */
  private drawAllThinkingBubbles() {
    if (!this.state) return;

    const mainPos = this.layoutEngine.getMainAgentPosition();
    const mainRadius = this.layoutEngine.getMainAgentRadius();

    // 主 Agent 的思考气泡
    const mainThinkText = (this.state.mainAgent as any).thinkingText || this.state.mainAgent.currentThought;
    if (mainThinkText) {
      this.drawThinkingBubble(mainPos, mainRadius, mainThinkText);
    }

    // 子 Agent 的思考气泡
    const visibleAgents = this.state.subAgents.filter(a => a.status !== 'idle');
    visibleAgents.forEach((agent, index) => {
      const pos = this.treePositions.get(agent.id)
        || this.layoutEngine.getSubAgentPosition(index, visibleAgents.length);
      const radius = this.layoutEngine.getSubAgentRadius();

      // 🔧 辩论模式特殊处理
      const isDebateAgent = agent.multiAgent?.strategy === 'debate';
      const isCurrentSpeaker = isDebateAgent && agent.status === 'running';

      // 🔧 辩论模式：只显示当前发言者的气泡
      if (agent.thinkingText) {
        if (isDebateAgent) {
          // 辩论模式：只有当前发言者显示气泡
          if (isCurrentSpeaker) {
            this.drawThinkingBubble(pos, radius, agent.thinkingText);
          }
        } else {
          // 非辩论模式：正常显示
          this.drawThinkingBubble(pos, radius, agent.thinkingText);
        }
      }
    });
  }

  /**
   * 绘制思考气泡（节点正上方，淡紫色）
   */
  private drawThinkingBubble(agentPos: Point, agentRadius: number, text: string) {
    const maxWidth = 220; // 气泡宽度
    const padding = 12;
    const lineHeight = 16;
    const maxLines = 5; // 固定最大行数，保持气泡高度稳定

    // 🔧 流式展示优化：固定气泡高度，内容向上滚动
    // 1. 先将文本按行分割
    this.ctx.font = '11px sans-serif';
    const allLines = this.wrapText(text, maxWidth - padding * 2, 999); // 先获取所有行

    // 2. 只显示最后 maxLines 行（模拟向上滚动效果）
    const displayLines = allLines.slice(-maxLines);

    // 3. 气泡尺寸固定（基于 maxLines）
    const bubbleWidth = maxWidth;
    const bubbleHeight = maxLines * lineHeight + padding * 2;

    const bubblePos = this.layoutEngine.getThinkingBubblePosition(
      agentPos, agentRadius, bubbleWidth, bubbleHeight
    );

    // 🔧 判断气泡位置（左侧、右侧、上方或下方）
    const isLeft = bubblePos.x + bubbleWidth < agentPos.x - agentRadius;
    const isRight = bubblePos.x > agentPos.x + agentRadius;
    const isAbove = !isLeft && !isRight && bubblePos.y + bubbleHeight < agentPos.y;
    const isBelow = !isLeft && !isRight && bubblePos.y > agentPos.y;

    // 淡紫色背景
    this.ctx.fillStyle = 'rgba(124,140,245,0.15)';
    this.ctx.strokeStyle = 'rgba(124,140,245,0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundRect(bubblePos.x, bubblePos.y, bubbleWidth, bubbleHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();

    // 🔧 小三角尾巴（动态计算最佳连接点）
    this.ctx.fillStyle = 'rgba(124,140,245,0.15)';
    this.ctx.strokeStyle = 'rgba(124,140,245,0.6)';
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

    // 支持多行文本（用 \n 分隔）
    const lines = moment.label.split('\n');

    this.ctx.font = '11px sans-serif';
    const maxLineWidth = Math.max(...lines.map(line => this.ctx.measureText(line).width));
    const tagWidth = iconWidth + maxLineWidth + padding.x * 3;
    const tagHeight = Math.max(24, lines.length * lineHeight + padding.y * 2);

    // 传入实际尺寸，让 LayoutEngine 做碰撞避让
    const tagPos = this.layoutEngine.getMomentTagPosition(agentPos, agentRadius, tagWidth, tagHeight);

    // 背景色按类型
    this.ctx.fillStyle = this.getMomentBgColor(moment.type, moment.status);
    this.ctx.beginPath();
    this.roundRect(tagPos.x, tagPos.y, tagWidth, tagHeight, 12);
    this.ctx.fill();

    // 图标（垂直居中）
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(moment.icon, tagPos.x + padding.x, tagPos.y + tagHeight / 2);

    // 标签文字（多行）
    this.ctx.font = '11px sans-serif';
    const textStartY = tagPos.y + padding.y + lineHeight / 2;
    lines.forEach((line, i) => {
      this.ctx.fillText(
        line,
        tagPos.x + padding.x + iconWidth,
        textStartY + i * lineHeight
      );
    });

    // 右下角状态/耗时
    const durationText = moment.status === 'running'
      ? '↻'
      : `✓${(moment.durationMs / 1000).toFixed(1)}s`;
    this.ctx.font = '9px monospace';
    this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
    this.ctx.textAlign = 'right';
    this.ctx.fillText(durationText, tagPos.x + tagWidth - 4, tagPos.y + tagHeight - 4);
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
  }

  private getMomentBgColor(type: string, status: string): string {
    if (status === 'error') return 'rgba(239,68,68,0.85)';
    const map: Record<string, string> = {
      file: 'rgba(59,130,246,0.8)',
      bash: 'rgba(75,85,99,0.9)',
      skill: 'rgba(139,92,246,0.8)',
      memory_read: 'rgba(16,185,129,0.8)',
      memory_write: 'rgba(16,185,129,0.8)',
      thinking: 'rgba(124,140,245,0.6)',
    };
    return map[type] || 'rgba(75,85,99,0.8)';
  }

  // ─── 区域4：左侧历史点阵 ────────────────────────────────────

  /**
   * 绘制左侧历史点阵
   */
  private drawHistoryDots(agentPos: Point, agentRadius: number, dots: HistoryDot[]) {
    const dotRadius = 4;
    const dotSpacing = 10;
    const visible = dots.slice(-8); // 最多8个
    const origin = this.layoutEngine.getHistoryDotsOrigin(agentPos, agentRadius, visible.length);

    visible.forEach((dot, i) => {
      const cx = origin.x;
      const cy = origin.y + i * dotSpacing;

      this.ctx.beginPath();
      this.ctx.arc(cx, cy, dotRadius, 0, 2 * Math.PI);

      if (dot.status === 'running') {
        this.ctx.strokeStyle = '#8A8A8A';
        this.ctx.lineWidth = 1.5;
        this.ctx.fillStyle = 'transparent';
        this.ctx.fill();
        this.ctx.stroke();
      } else {
        this.ctx.fillStyle = dot.status === 'success' ? '#34D399' : '#F87171';
        this.ctx.fill();
      }
    });
  }

  // ─── 区域5：下方时间条 ──────────────────────────────────────

  /**
   * 绘制下方时间条
   */
  private drawTimelineStrip(agentPos: Point, agentRadius: number, events: TimelineEvent[]) {
    const origin = this.layoutEngine.getTimelineOrigin(agentPos, agentRadius);
    const stripHeight = 22;
    const pillPadding = { x: 6, y: 3 };
    const gap = 4;
    const visible = events.slice(-5);

    let curX = origin.x;

    visible.forEach((evt) => {
      this.ctx.font = '10px sans-serif';
      const labelText = `${evt.icon} ${evt.label}`;
      const textWidth = this.ctx.measureText(labelText).width;
      const pillWidth = textWidth + pillPadding.x * 2;
      const pillY = origin.y;

      // 背景
      const bgColor = evt.status === 'success'
        ? 'rgba(52,211,153,0.2)'
        : evt.status === 'error'
          ? 'rgba(248,113,113,0.2)'
          : 'rgba(124,140,245,0.2)';
      this.ctx.fillStyle = bgColor;
      this.ctx.beginPath();
      this.roundRect(curX, pillY, pillWidth, stripHeight, stripHeight / 2);
      this.ctx.fill();

      // 文字
      this.ctx.fillStyle = evt.status === 'success'
        ? '#34D399'
        : evt.status === 'error'
          ? '#F87171'
          : '#C4CAFF';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(labelText, curX + pillPadding.x, pillY + stripHeight / 2);

      // 耗时
      if (evt.duration !== undefined) {
        const durText = `${(evt.duration / 1000).toFixed(1)}s`;
        this.ctx.font = '9px monospace';
        this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
        this.ctx.fillText(durText, curX + pillWidth - this.ctx.measureText(durText).width - 2, pillY + stripHeight - 4);
      } else if (evt.status === 'running') {
        // 旋转点动画（简单用 ↻ 代替）
        this.ctx.font = '9px monospace';
        this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
        this.ctx.fillText('↻', curX + pillWidth - 10, pillY + stripHeight - 4);
      }

      curX += pillWidth + gap;
    });

    this.ctx.textBaseline = 'alphabetic';
  }

  // ─── 右侧工具调用堆栈 ─────────────────────────────────────────

  /**
   * 绘制工具调用堆栈（节点右侧，垂直排列，最多 4 个）
   * 🔧 显示正在运行和最近完成的工具（成功/失败），完成后短暂保留再消失
   */
  private drawToolCallStack(
    agentPos: Point,
    agentRadius: number,
    events: TimelineEvent[]
  ) {
    const gap = 8;
    const itemHeight = 26;
    const itemSpacing = 4;
    const maxVisible = 4; // 🔧 最多显示 4 个

    // 🔧 显示正在运行的工具 + 最近完成的工具（3秒内）
    const now = Date.now();
    const recentThreshold = 3000; // 3秒
    const visibleEvents = events.filter(evt => {
      if (evt.status === 'running') return true;
      // 已完成的工具：如果在 3 秒内完成，则显示
      if ((evt.status === 'success' || evt.status === 'error') && evt.startTime) {
        const elapsed = now - evt.startTime;
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

    // 绘制可见的工具
    displayEvents.forEach((evt, index) => {
      const verticalOffset = (hiddenCount > 0 ? 1 : 0) * (itemHeight + itemSpacing) + index * (itemHeight + itemSpacing);
      this.drawToolCallItem(agentPos, agentRadius, evt, verticalOffset, gap, itemHeight, startY);
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
    startY: number // 🔧 新增参数：起始 Y 坐标
  ) {
    const padding = { x: 8, y: 5 };
    const iconWidth = 16;

    this.ctx.font = '11px sans-serif';
    const labelWidth = this.ctx.measureText(event.label).width;
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
    this.ctx.fillText(event.label, tagPos.x + padding.x + iconWidth, tagPos.y + itemHeight / 2);

    // ✅ 右侧显示计时或状态
    let timeText = '';
    if (event.status === 'running' && event.startTime) {
      const elapsed = Date.now() - event.startTime;
      timeText = `${(elapsed / 1000).toFixed(1)}s`;
    } else if (event.status === 'success' && event.duration) {
      timeText = `✓${(event.duration / 1000).toFixed(1)}s`;
    } else if (event.status === 'error') {
      timeText = '✗';
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

  /**
   * 根据图标推断工具类型（用于配色）
   */
  private inferToolType(icon: string): MomentType {
    const typeMap: Record<string, MomentType> = {
      '🗂': 'file',  // read
      '📝': 'file',  // write
      '✏️': 'file',  // edit
      '⚡': 'bash',  // bash
      '🔍': 'file',  // glob
      '🔎': 'file',  // grep
      '🧠': 'memory_read',
      '💾': 'memory_write',
      '✨': 'skill',
    };
    return typeMap[icon] || 'idle';
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

  // ─── 左下角事件流 ────────────────────────────────────────────

  /**
   * 绘制左下角事件流（最近5条）
   */
  private drawEventFeed(events: RecentEvent[]) {
    if (!events || events.length === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const feedWidth = 260;
    const itemHeight = 22;
    const padding = 8;
    const visible = events.slice(-5);
    const feedHeight = visible.length * itemHeight + padding * 2;
    const feedX = 12;
    const feedY = rect.height - feedHeight - 12;

    // 背景
    this.ctx.fillStyle = 'rgba(30,30,30,0.85)';
    this.ctx.strokeStyle = 'rgba(58,58,58,0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundRect(feedX, feedY, feedWidth, feedHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();

    visible.forEach((evt, i) => {
      const y = feedY + padding + i * itemHeight + itemHeight / 2;
      const timeStr = new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // 图标
      this.ctx.font = '12px sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillStyle = '#8A8A8A';
      this.ctx.fillText(evt.icon, feedX + padding, y);

      // 时间
      this.ctx.font = '10px monospace';
      this.ctx.fillStyle = '#5A5A5A';
      this.ctx.fillText(timeStr, feedX + padding + 18, y);

      // Agent 名
      this.ctx.font = 'bold 10px sans-serif';
      this.ctx.fillStyle = '#7C8CF5';
      this.ctx.fillText(evt.agentName, feedX + padding + 70, y);

      // 描述
      this.ctx.font = '10px sans-serif';
      this.ctx.fillStyle = '#C4C4C4';
      const descX = feedX + padding + 70 + this.ctx.measureText(evt.agentName).width + 4;
      const maxDescWidth = feedWidth - (descX - feedX) - padding;
      const desc = this.truncateText(evt.description, maxDescWidth);
      this.ctx.fillText(desc, descX, y);
    });

    this.ctx.textBaseline = 'alphabetic';
  }

  // ─── 文本辅助 ────────────────────────────────────────────────

  /** 自动换行，返回不超过 maxLines 行的数组 */
  private wrapText(text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split('');
    const lines: string[] = [];
    let current = '';

    for (const ch of words) {
      const test = current + ch;
      if (this.ctx.measureText(test).width > maxWidth) {
        if (current) lines.push(current);
        current = ch;
        if (lines.length >= maxLines - 1) break;
      } else {
        current = test;
      }
    }
    if (current) {
      if (lines.length >= maxLines) {
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
      } else {
        lines.push(current);
      }
    }
    return lines.slice(0, maxLines);
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
   * 绘制统计信息
   */
  private drawStats() {
    if (!this.state) return;

    const pos = this.layoutEngine.getStatsPosition();
    const stats = this.state.stats;
    const rect = this.canvas.getBoundingClientRect();
    const boxWidth = Math.min(200, rect.width - 20);
    const boxHeight = stats.currentCallTokens > 0 ? 68 : 52;

    // 背景（使用璇玑的背景色）
    this.ctx.fillStyle = 'rgba(45, 45, 45, 0.9)'; // bg-secondary with opacity
    this.ctx.beginPath();
    this.roundRect(pos.x, pos.y, boxWidth, boxHeight, 8);
    this.ctx.fill();

    // 边框
    this.ctx.strokeStyle = 'rgba(58, 58, 58, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';

    // 第一行：累计 Token（使用璇玑的 warning 色）
    this.ctx.fillStyle = '#FBBF24'; // warning
    this.ctx.fillText(`Tokens: ${stats.totalTokens.toLocaleString()}`, pos.x + 10, pos.y + 18);

    // 第二行：轮次（左）+ 耗时（右）
    this.ctx.fillStyle = '#34D399'; // success
    this.ctx.fillText(`迭代: ${stats.iteration}`, pos.x + 10, pos.y + 38);

    this.ctx.fillStyle = '#7C8CF5'; // primary
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`0.0s`, pos.x + boxWidth - 10, pos.y + 38);
    this.ctx.textAlign = 'left'; // 还原

    // 第三行：本次 LLM call 的 token 增量（仅当有数据时显示）
    if (stats.currentCallTokens > 0) {
      this.ctx.fillStyle = '#8A8A8A'; // text-secondary
      this.ctx.fillText(`本次: +${stats.currentCallTokens.toLocaleString()}`, pos.x + 10, pos.y + 58);
    }
  }

  /**
   * 绘制工具提示
   */
  private drawToolTip(agentPos: Point, agentRadius: number, toolName: string) {
    const tipWidth = 120;
    const tipHeight = 30;
    const tipPos = this.layoutEngine.getBubblePosition(
      agentPos,
      agentRadius,
      tipWidth,
      tipHeight,
      'right'
    );

    // 背景（使用璇玑的 success 色）
    this.ctx.fillStyle = 'rgba(52, 211, 153, 0.9)'; // success with opacity
    this.ctx.beginPath();
    this.roundRect(tipPos.x, tipPos.y, tipWidth, tipHeight, 6);
    this.ctx.fill();

    // 文本
    this.ctx.fillStyle = '#E4E4E4'; // text-primary
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`🔧 ${toolName}`, tipPos.x + 8, tipPos.y + 19);
  }

  /**
   * 绘制 Agent 类型标签
   */
  private drawAgentTypeLabel(agentPos: Point, agentRadius: number, agentType: 'builtin' | 'preset' | 'custom' | 'temporary') {
    const labelConfig = {
      preset: { text: '预置', color: 'rgba(52, 211, 153, 0.9)', icon: '📦' }, // green - 预置 agent
      builtin: { text: '内置', color: 'rgba(59, 130, 246, 0.9)', icon: '⚡' }, // blue - 系统内置
      custom: { text: '自定义', color: 'rgba(168, 85, 247, 0.9)', icon: '✨' }, // purple - 用户自定义
      temporary: { text: '临时', color: 'rgba(156, 163, 175, 0.9)', icon: '⏱' }, // gray - 临时 agent
    };

    const config = labelConfig[agentType] || labelConfig.builtin; // 默认使用 builtin
    const labelWidth = 60;
    const labelHeight = 20;
    const labelX = agentPos.x - labelWidth / 2;
    const labelY = agentPos.y + agentRadius + 28; // 在名称下方

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
   */
  private drawProgressRing(center: Point, radius: number, progress: number) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + 2 * Math.PI * progress;

    this.ctx.strokeStyle = '#34D399'; // success
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, radius + 5, startAngle, endAngle);
    this.ctx.stroke();
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
  private getAgentColor(status: AgentState): string {
    switch (status) {
      case 'thinking':
        return '#5B6FD8'; // 蓝色（稍微调暗）
      case 'executing':
        return '#2BA76F'; // 绿色（稍微调暗）
      case 'waiting':
        return '#D4A017'; // 黄色（稍微调暗）
      case 'error':
        return '#D85B5B'; // 红色（稍微调暗）
      case 'done':
        return '#2BA76F'; // 绿色
      default:
        return '#3A3A3A'; // bg-tertiary
    }
  }

  /**
   * 获取 Agent 边框颜色（使用璇玑主题色）
   */
  private getAgentBorderColor(status: AgentState): string {
    switch (status) {
      case 'thinking':
        return '#7C8CF5'; // primary
      case 'executing':
        return '#34D399'; // success
      case 'waiting':
        return '#FBBF24'; // warning
      case 'error':
        return '#F87171'; // error
      case 'done':
        return '#34D399'; // success
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
        return '#5B6FD8'; // 蓝色
      case 'success':
        return '#2BA76F'; // 绿色
      case 'error':
        return '#D85B5B'; // 红色
      default:
        return '#3A3A3A'; // bg-tertiary
    }
  }

  /**
   * 获取子 Agent 边框颜色（使用璇玑主题色）
   */
  private getSubAgentBorderColor(status: SubAgentState): string {
    switch (status) {
      case 'running':
        return '#7C8CF5'; // primary
      case 'success':
        return '#34D399'; // success
      case 'error':
        return '#F87171'; // error
      default:
        return '#8A8A8A'; // text-secondary
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
        return '执行中';
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

  /**
   * 根据 Agent 数量和团队边界框动态更新画布尺寸
   */
  updateCanvasSize(subAgents: SubAgentData[]) {
    // 获取容器的实际尺寸（从父元素获取）
    const container = this.canvas.parentElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // 如果没有子 Agent，使用容器尺寸
    if (subAgents.length === 0) {
      this.setCanvasSize(containerWidth, containerHeight);
      return;
    }

    // 🔧 计算所有内容的边界（包括团队边界框）
    const padding = 80; // 边距
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    // 主 agent 位置
    const mainPos = this.layoutEngine.getMainAgentPosition();
    minX = Math.min(minX, mainPos.x - 50);
    maxX = Math.max(maxX, mainPos.x + 50);
    minY = Math.min(minY, mainPos.y - 50);
    maxY = Math.max(maxY, mainPos.y + 50);

    // 所有子 agent 位置
    this.treePositions.forEach((pos) => {
      minX = Math.min(minX, pos.x - 50);
      maxX = Math.max(maxX, pos.x + 50);
      minY = Math.min(minY, pos.y - 50);
      maxY = Math.max(maxY, pos.y + 50);
    });

    // 团队边界框
    if (this.state?.teamBoundaries) {
      this.state.teamBoundaries.forEach((team) => {
        if (team.bounds) {
          minX = Math.min(minX, team.bounds.x);
          maxX = Math.max(maxX, team.bounds.x + team.bounds.width);
          minY = Math.min(minY, team.bounds.y);
          maxY = Math.max(maxY, team.bounds.y + team.bounds.height);
        }
      });
    }

    // 计算所需尺寸（加上 padding）
    const requiredWidth = maxX - minX + padding * 2;
    const requiredHeight = maxY - minY + padding * 2;

    // 🔧 使用计算尺寸和容器尺寸的较大值
    const newWidth = Math.max(containerWidth, requiredWidth);
    const newHeight = Math.max(containerHeight, requiredHeight);

    console.log('[CanvasRenderer] updateCanvasSize:', {
      containerWidth,
      containerHeight,
      requiredWidth,
      requiredHeight,
      newWidth,
      newHeight,
    });

    this.setCanvasSize(newWidth, newHeight);
  }

  /**
   * 设置画布尺寸（内部方法）
   */
  private setCanvasSize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    const currentWidth = this.canvas.width / dpr;
    const currentHeight = this.canvas.height / dpr;

    // 只在尺寸变化时更新（避免不必要的重绘）
    if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;

      this.ctx.scale(dpr, dpr);

      // 更新布局引擎配置
      this.layoutEngine.updateSize(width, height);
    }
  }

  /**
   * 调整画布尺寸
   */
  resize() {
    this.setupHighDPI();
  }

  /**
   * 销毁
   */
  destroy() {
    this.stop();
    this.animationEngine.clear();
  }
}
