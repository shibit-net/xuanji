// ============================================================
// Workspace Monitor - Canvas 渲染器
// ============================================================

import type {
  WorkspaceState,
  Point,
  AgentState,
  SubAgentState,
  SubAgentData,
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
    const rect = this.canvas.getBoundingClientRect();

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
    this.updateAnimations();
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

    const index = this.state.subAgents.findIndex((a) => a.id === agentId);
    if (index !== -1) {
      return this.layoutEngine.getSubAgentPosition(index, this.state.subAgents.length);
    }

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
      this.drawConnections();
      this.drawSubAgents();
      this.drawMainAgent();
      this.drawStats();
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

    // 绘制图标
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '32px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🤖', pos.x, pos.y);

    // 绘制名称
    this.ctx.fillStyle = '#E4E4E4'; // text-primary
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText(agent.name, pos.x, pos.y + radius + 20);

    // 绘制思考气泡
    if (agent.currentThought) {
      this.drawBubble(pos, radius, agent.currentThought, 'top');
    }

    // 绘制工具提示
    if (agent.currentTool) {
      this.drawToolTip(pos, radius, agent.currentTool);
    }
  }

  /**
   * 绘制子 Agent
   */
  private drawSubAgents() {
    if (!this.state) return;

    this.state.subAgents.forEach((agent, index) => {
      const pos = this.layoutEngine.getSubAgentPosition(
        index,
        this.state!.subAgents.length
      );
      const radius = this.layoutEngine.getSubAgentRadius();

      // 绘制圆形背景
      this.ctx.fillStyle = this.getSubAgentColor(agent.status);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      this.ctx.fill();

      // 绘制边框
      this.ctx.strokeStyle = this.getSubAgentBorderColor(agent.status);
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // 绘制图标/名称首字母
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '20px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      const icon = this.getToolIcon(agent.name);
      this.ctx.fillText(icon, pos.x, pos.y);

      // 绘制名称
      this.ctx.fillStyle = '#8A8A8A'; // text-secondary
      this.ctx.font = '11px sans-serif';
      this.ctx.fillText(agent.name, pos.x, pos.y + radius + 15);

      // 如果正在执行，绘制进度环
      if (agent.status === 'running' && agent.progress !== undefined) {
        this.drawProgressRing(pos, radius, agent.progress);
      }

      // 悬停时显示详情卡片
      if (this.hoveredAgent === agent.id) {
        this.drawAgentCard(pos, radius, agent);
      }
    });
  }

  /**
   * 绘制连接线
   */
  private drawConnections() {
    if (!this.state) return;

    this.state.collaborations.forEach((collab) => {
      const fromPos = this.getAgentPosition(collab.from);
      const toPos = this.getAgentPosition(collab.to);

      if (fromPos && toPos) {
        const path = this.layoutEngine.getConnectionPath(fromPos, toPos);

        // 绘制贝塞尔曲线（使用璇玑主题色）
        this.ctx.strokeStyle = collab.active ? '#34D399' : '#3A3A3A'; // success : bg-tertiary
        this.ctx.lineWidth = collab.active ? 2 : 1;
        this.ctx.setLineDash(collab.type === 'data' ? [5, 5] : []);
        this.ctx.beginPath();
        this.ctx.moveTo(path.start.x, path.start.y);
        this.ctx.quadraticCurveTo(
          path.control.x,
          path.control.y,
          path.end.x,
          path.end.y
        );
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    });
  }

  /**
   * 绘制统计信息
   */
  private drawStats() {
    if (!this.state) return;

    const pos = this.layoutEngine.getStatsPosition();
    const stats = this.state.stats;

    // 背景（使用璇玑的背景色）
    this.ctx.fillStyle = 'rgba(30, 30, 30, 0.8)'; // bg-primary with opacity
    this.ctx.beginPath();
    this.roundRect(pos.x, pos.y, 300, 40, 8);
    this.ctx.fill();

    // Token（使用璇玑的 warning 色）
    this.ctx.fillStyle = '#FBBF24'; // warning
    this.ctx.font = '13px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`🪙 Token: ${stats.totalTokens.toLocaleString()}`, pos.x + 10, pos.y + 15);

    // 耗时（使用璇玑的 primary 色）
    this.ctx.fillStyle = '#7C8CF5'; // primary
    this.ctx.fillText(`⏱ ${stats.duration.toFixed(1)}s`, pos.x + 10, pos.y + 32);

    // 轮次（使用璇玑的 success 色）
    this.ctx.fillStyle = '#34D399'; // success
    this.ctx.fillText(`🔄 轮次: ${stats.iteration}`, pos.x + 150, pos.y + 15);
  }

  /**
   * 绘制气泡
   */
  private drawBubble(agentPos: Point, agentRadius: number, text: string, direction: 'top' | 'right' = 'top') {
    const maxWidth = 200;
    const padding = 10;
    const lineHeight = 16;

    // 计算文本尺寸
    this.ctx.font = '12px sans-serif';
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    words.forEach((word) => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = this.ctx.measureText(testLine);
      if (metrics.width > maxWidth - padding * 2) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    if (currentLine) lines.push(currentLine);

    const bubbleWidth = maxWidth;
    const bubbleHeight = lines.length * lineHeight + padding * 2;

    const bubblePos = this.layoutEngine.getBubblePosition(
      agentPos,
      agentRadius,
      bubbleWidth,
      bubbleHeight,
      direction
    );

    // 绘制气泡背景（使用璇玑的 primary 色）
    this.ctx.fillStyle = 'rgba(124, 140, 245, 0.9)'; // primary with opacity
    this.ctx.beginPath();
    this.roundRect(bubblePos.x, bubblePos.y, bubbleWidth, bubbleHeight, 8);
    this.ctx.fill();

    // 绘制文本
    this.ctx.fillStyle = '#E4E4E4'; // text-primary
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      this.ctx.fillText(
        line,
        bubblePos.x + padding,
        bubblePos.y + padding + (i + 1) * lineHeight - 4
      );
    });
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
