// ============================================================
// Workspace Monitor - 布局引擎（带碰撞检测 + 策略感知布局）
// ============================================================

import type { Point, Path, Rect, LayoutConfig, SubAgentData, TeamBoundary, TeamStrategy } from './types';

const VIRTUAL_WIDTH = 5000;
const VIRTUAL_HEIGHT = 4000;
const VIRTUAL_PADDING = 400;

export class LayoutEngine {
  private config: LayoutConfig;
  /** 当前帧已占用的矩形区域，用于碰撞避让 */
  private occupiedRects: Rect[] = [];
  /** 虚拟画布内容边界（根据实际内容动态扩展） */
  private contentBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  /** 成员位置缓存（key: memberId 或 agentId，确保多轮后位置稳定） */
  private positionCache: Map<string, Point> = new Map();

  constructor(canvasWidth: number, canvasHeight: number) {
    this.config = {
      centerX: canvasWidth / 2,
      centerY: canvasHeight / 2,
      mainRadius: 40,
      subRadius: 25,
      orbitRadius: 150,
      canvasWidth: Math.max(canvasWidth, VIRTUAL_WIDTH),
      canvasHeight: Math.max(canvasHeight, VIRTUAL_HEIGHT),
    };
  }

  // ─── 位置缓存辅助 ─────────────────────────────────────────

  /** 获取 agent 的稳定标识键（优先 memberId，回退 id） */
  private getStableKey(agent: SubAgentData): string {
    return agent.multiAgent?.memberId || agent.id;
  }

  /** 清除位置缓存（workspace 重置时调用） */
  clearPositionCache(): void {
    this.positionCache.clear();
  }

  /** 按保留的 agent ID 集合裁剪缓存，防止长时间任务中缓存无限增长 */
  prunePositionCache(activeAgentIds: Set<string>): void {
    for (const [key] of this.positionCache) {
      // 保留活跃 agent 的位置，以及 lookup key 在活跃集合中的
      if (!activeAgentIds.has(key)) {
        this.positionCache.delete(key);
      }
    }
  }

  /**
   * 获取 agent 的稳定位置（优先使用树形布局位置，fallback 时用缓存避免位置跳动）
   */
  getStableAgentPosition(agent: SubAgentData, treePositions: Map<string, Point>, index: number, total: number): Point {
    const treePos = treePositions.get(agent.id);
    if (treePos) return treePos;

    const key = this.getStableKey(agent);
    const cached = this.positionCache.get(key);
    if (cached) return cached;

    const pos = this.getSubAgentPosition(index, total);
    this.positionCache.set(key, pos);
    return pos;
  }

  // ─── 碰撞检测 ─────────────────────────────────────────────

  /** 每帧开始时重置已占用区域 */
  resetOccupied() {
    this.occupiedRects = [];
  }

  /** 注册一个已占用的矩形 */
  addOccupied(rect: Rect) {
    this.occupiedRects.push(rect);
  }

  /** 检查矩形是否与任何已占用区域重叠 */
  private isOverlapping(rect: Rect): boolean {
    for (const occ of this.occupiedRects) {
      if (
        rect.x < occ.x + occ.width &&
        rect.x + rect.width > occ.x &&
        rect.y < occ.y + occ.height &&
        rect.y + rect.height > occ.y
      ) {
        return true;
      }
    }
    return false;
  }

  /** 检查矩形是否在虚拟画布边界内 */
  private isInBounds(rect: Rect): boolean {
    const pad = VIRTUAL_PADDING;
    return (
      rect.x >= pad &&
      rect.y >= pad &&
      rect.x + rect.width <= this.config.canvasWidth - pad &&
      rect.y + rect.height <= this.config.canvasHeight - pad
    );
  }

  /** 将矩形 clamp 到虚拟画布内 */
  private clampRect(rect: Rect): Rect {
    const pad = VIRTUAL_PADDING;
    let { x, y, width, height } = rect;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    if (x + width > this.config.canvasWidth - pad) x = this.config.canvasWidth - pad - width;
    if (y + height > this.config.canvasHeight - pad) y = this.config.canvasHeight - pad - height;
    return { x, y, width, height };
  }

  // ─── 尺寸 ─────────────────────────────────────────────────

  /** 更新虚拟画布尺寸并动态扩展布局中心 */
  updateSize(width: number, height: number) {
    this.config.centerX = width / 2;
    this.config.centerY = height / 2;
    this.config.canvasWidth = Math.max(width, this.config.canvasWidth);
    this.config.canvasHeight = Math.max(height, this.config.canvasHeight);
  }

  /** 获取虚拟画布尺寸 */
  getVirtualSize(): { width: number; height: number } {
    return {
      width: this.config.canvasWidth,
      height: this.config.canvasHeight,
    };
  }

  /** 获取内容边界（用于自动适配视图） */
  getContentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return this.contentBounds;
  }

  /** 更新内容边界 */
  private updateContentBounds(x: number, y: number, margin: number = 200) {
    if (!this.contentBounds) {
      this.contentBounds = {
        minX: x - margin,
        minY: y - margin,
        maxX: x + margin,
        maxY: y + margin,
      };
    } else {
      this.contentBounds.minX = Math.min(this.contentBounds.minX, x - margin);
      this.contentBounds.minY = Math.min(this.contentBounds.minY, y - margin);
      this.contentBounds.maxX = Math.max(this.contentBounds.maxX, x + margin);
      this.contentBounds.maxY = Math.max(this.contentBounds.maxY, y + margin);
    }
  }

  getMainAgentRadius(): number {
    return this.config.mainRadius;
  }

  getSubAgentRadius(): number {
    return this.config.subRadius;
  }

  // ─── 主 Agent 位置 ────────────────────────────────────────

  getMainAgentPosition(): Point {
    const pos = {
      x: this.config.centerX,
      y: this.config.canvasHeight * 0.2,
    };
    this.updateContentBounds(pos.x, pos.y, 300);
    return pos;
  }

  // ─── 子 Agent 位置（多行自适应）───────────────────────────

  getSubAgentPosition(index: number, total: number): Point {
    if (total === 0) {
      return { x: this.config.centerX, y: this.config.centerY + 320 };
    }

    const mainY = this.getMainAgentPosition().y;
    const verticalGap = 320;

    const cellWidth = 160;
    const usableWidth = this.config.canvasWidth - VIRTUAL_PADDING * 2;
    const perRow = Math.max(1, Math.floor(usableWidth / cellWidth));

    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const colsInRow = Math.min(perRow, total - row * perRow);

    const rowWidth = (colsInRow - 1) * cellWidth;
    const startX = this.config.centerX - rowWidth / 2;

    const x = startX + col * cellWidth;
    const y = mainY + verticalGap + row * 160;

    return { x, y };
  }

  // ─── 连接线 ───────────────────────────────────────────────

  getConnectionPath(from: Point, to: Point): Path {
    const midY = (from.y + to.y) / 2;
    return {
      points: [
        from,
        { x: from.x, y: midY },
        { x: to.x, y: midY },
        to,
      ],
    };
  }

  // ─── 思考气泡（带碰撞避让）────────────────────────────────

  /**
   * 计算思考气泡位置，自动避让已占用区域和 canvas 边界
   * 会自动注册到 occupiedRects
   * 🔧 优化：增加更多候选位置，确保气泡不遮挡agent
   */
  getThinkingBubblePosition(
    agentPos: Point,
    agentRadius: number,
    bubbleWidth: number,
    bubbleHeight: number,
    preferTop: boolean = false,
  ): Point {
    const gap = 30;

    // 候选位置：团队并行模式优先上方（避免与左侧邻居的工具堆栈重叠），独立 agent 优先左侧
    const topFirst = preferTop;
    const candidates: Point[] = topFirst ? [
      // 第一优先级：上方（水平居中）
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap - bubbleHeight },
      // 第二优先级：左侧（垂直居中）
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      // 第三优先级：右侧（垂直居中）
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - bubbleHeight / 2 },
      // 第四优先级：下方（水平居中）
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap },
      // 对角线
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y - agentRadius - gap - bubbleHeight },
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - agentRadius - gap - bubbleHeight },
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y + agentRadius + gap },
      { x: agentPos.x + agentRadius + gap, y: agentPos.y + agentRadius + gap },
      // 更远位置
      { x: agentPos.x - agentRadius - gap * 2 - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x + agentRadius + gap * 2, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap * 2 - bubbleHeight },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap * 2 },
      // 极远位置
      { x: agentPos.x - agentRadius - gap * 3 - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x + agentRadius + gap * 3, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap * 3 - bubbleHeight },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap * 3 },
    ] : [
      // 第一优先级：左侧（垂直居中）
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      // 第二优先级：上方（水平居中）
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap - bubbleHeight },
      // 第三优先级：右侧（垂直居中）
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - bubbleHeight / 2 },

      // 第四优先级：下方（水平居中）
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap },

      // 第三优先级：四个对角线位置
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y - agentRadius - gap - bubbleHeight },
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - agentRadius - gap - bubbleHeight },
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y + agentRadius + gap },
      { x: agentPos.x + agentRadius + gap, y: agentPos.y + agentRadius + gap },

      // 🔧 第四优先级：更远的左右位置（gap * 2）
      { x: agentPos.x - agentRadius - gap * 2 - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x + agentRadius + gap * 2, y: agentPos.y - bubbleHeight / 2 },

      // 🔧 第五优先级：更远的上下位置（gap * 2）
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap * 2 - bubbleHeight },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap * 2 },

      // 🔧 第六优先级：更远的对角线位置（gap * 2）
      { x: agentPos.x - agentRadius - gap * 2 - bubbleWidth, y: agentPos.y - agentRadius - gap * 2 - bubbleHeight },
      { x: agentPos.x + agentRadius + gap * 2, y: agentPos.y - agentRadius - gap * 2 - bubbleHeight },
      { x: agentPos.x - agentRadius - gap * 2 - bubbleWidth, y: agentPos.y + agentRadius + gap * 2 },
      { x: agentPos.x + agentRadius + gap * 2, y: agentPos.y + agentRadius + gap * 2 },

      // 🔧 第七优先级：极远位置（gap * 3）
      { x: agentPos.x - agentRadius - gap * 3 - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x + agentRadius + gap * 3, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap * 3 - bubbleHeight },
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + gap * 3 },
    ];

    // 尝试每个候选位置
    for (const pos of candidates) {
      const rect: Rect = { x: pos.x, y: pos.y, width: bubbleWidth, height: bubbleHeight };
      const clamped = this.clampRect(rect);
      if (!this.isOverlapping(clamped) && this.isInBounds(clamped)) {
        this.addOccupied(clamped);
        return { x: clamped.x, y: clamped.y };
      }
    }

    // 🔧 所有候选都有碰撞，尝试垂直偏移策略（更大的偏移范围）
    for (let offset = 30; offset <= 200; offset += 30) {
      // 尝试向上偏移
      const upRect: Rect = {
        x: candidates[0].x,
        y: candidates[0].y - offset,
        width: bubbleWidth,
        height: bubbleHeight,
      };
      const clampedUp = this.clampRect(upRect);
      if (!this.isOverlapping(clampedUp) && this.isInBounds(clampedUp)) {
        this.addOccupied(clampedUp);
        return { x: clampedUp.x, y: clampedUp.y };
      }

      // 尝试向下偏移
      const downRect: Rect = {
        x: candidates[0].x,
        y: candidates[0].y + offset,
        width: bubbleWidth,
        height: bubbleHeight,
      };
      const clampedDown = this.clampRect(downRect);
      if (!this.isOverlapping(clampedDown) && this.isInBounds(clampedDown)) {
        this.addOccupied(clampedDown);
        return { x: clampedDown.x, y: clampedDown.y };
      }

      // 🔧 尝试水平偏移（左右移动）
      const leftRect: Rect = {
        x: candidates[0].x - offset,
        y: candidates[0].y,
        width: bubbleWidth,
        height: bubbleHeight,
      };
      const clampedLeft = this.clampRect(leftRect);
      if (!this.isOverlapping(clampedLeft) && this.isInBounds(clampedLeft)) {
        this.addOccupied(clampedLeft);
        return { x: clampedLeft.x, y: clampedLeft.y };
      }

      const rightRect: Rect = {
        x: candidates[0].x + offset,
        y: candidates[0].y,
        width: bubbleWidth,
        height: bubbleHeight,
      };
      const clampedRight = this.clampRect(rightRect);
      if (!this.isOverlapping(clampedRight) && this.isInBounds(clampedRight)) {
        this.addOccupied(clampedRight);
        return { x: clampedRight.x, y: clampedRight.y };
      }
    }

    // 最后的 fallback：使用第一个候选位置并 clamp（即使重叠也要显示）
    const fallback = this.clampRect({
      x: candidates[0].x,
      y: candidates[0].y,
      width: bubbleWidth,
      height: bubbleHeight,
    });
    this.addOccupied(fallback);
    return { x: fallback.x, y: fallback.y };
  }

  // ─── 动作标签（带碰撞避让）────────────────────────────────

  /**
   * 右侧动作标签位置，溢出时自动调整
   * 会自动注册到 occupiedRects
   * 增加更多候选位置，确保不会盖在主 agent 上
   */
  getMomentTagPosition(agentPos: Point, agentRadius: number, tagWidth = 100, tagHeight = 24): Point {
    const gap = 12;
    const verticalOffset = agentRadius + gap;

    // 候选位置优先级：右上（避免与 timeline 重叠）→ 右侧 → 上方 → 下方 → 左侧
    const candidates: Point[] = [
      // 右上（currentMoment 在上，timeline 在下）
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - verticalOffset - tagHeight },
      // 右侧（水平居中）
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - tagHeight / 2 },
      // 上方（水平居中）
      { x: agentPos.x - tagWidth / 2, y: agentPos.y - verticalOffset - tagHeight },
      // 下方（水平居中）
      { x: agentPos.x - tagWidth / 2, y: agentPos.y + verticalOffset },
      // 左侧（水平居中）
      { x: agentPos.x - agentRadius - gap - tagWidth, y: agentPos.y - tagHeight / 2 },
      // 右下角
      { x: agentPos.x + agentRadius + gap, y: agentPos.y + verticalOffset },
    ];

    for (const pos of candidates) {
      const rect: Rect = { x: pos.x, y: pos.y, width: tagWidth, height: tagHeight };
      const clamped = this.clampRect(rect);
      if (!this.isOverlapping(clamped)) {
        this.addOccupied(clamped);
        return { x: clamped.x, y: clamped.y };
      }
    }

    // 如果所有候选位置都被占用，使用第一个候选位置（右侧）作为 fallback
    const fallback = this.clampRect({
      x: candidates[0].x,
      y: candidates[0].y,
      width: tagWidth,
      height: tagHeight,
    });
    this.addOccupied(fallback);
    return { x: fallback.x, y: fallback.y };
  }

  // ─── 历史点阵（带边界检查）────────────────────────────────

  getHistoryDotsOrigin(agentPos: Point, agentRadius: number, dotCount: number): Point {
    const gap = 10;
    const dotSpacing = 10;
    const totalHeight = (dotCount - 1) * dotSpacing;
    const x = agentPos.x - agentRadius - gap - 4;
    const y = agentPos.y - totalHeight / 2;
    return { x, y };
  }

  // ─── 时间条（带边界检查）──────────────────────────────────

  getTimelineOrigin(agentPos: Point, agentRadius: number): Point {
    const gap = 12;
    const timelineWidth = agentRadius * 6;
    const x = agentPos.x - timelineWidth / 2;
    const y = agentPos.y + agentRadius + gap;
    return { x, y };
  }

  // ─── 连线标签 ──────────────────────────────────────────────

  getConnectionLabelPosition(from: Point, to: Point): Point {
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
  }

  // ─── 统计区 ────────────────────────────────────────────────

  getStatsPosition(): Point {
    return {
      x: 20,
      y: this.config.canvasHeight - 60,
    };
  }

  // ─── 兼容旧接口 ───────────────────────────────────────────

  getBubblePosition(
    agentPos: Point,
    agentRadius: number,
    bubbleWidth: number,
    bubbleHeight: number,
    direction: 'top' | 'right' | 'bottom' | 'left' = 'top',
  ): Point {
    const padding = 20;
    switch (direction) {
      case 'top':
        return { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - bubbleHeight - padding };
      case 'right':
        return { x: agentPos.x + agentRadius + padding, y: agentPos.y - bubbleHeight / 2 };
      case 'bottom':
        return { x: agentPos.x - bubbleWidth / 2, y: agentPos.y + agentRadius + padding };
      case 'left':
        return { x: agentPos.x - agentRadius - bubbleWidth - padding, y: agentPos.y - bubbleHeight / 2 };
    }
  }

  // ─── 策略感知布局 ──────────────────────────────────────────

  /**
   * 根据 subAgents 的 parentAgentId 和 strategy 构建策略感知布局
   * 返回每个 agent ID → 位置的映射
   *
   * 布局顺序：
   * 1. team 容器节点 → 树形布局（像普通子Agent一样获得位置）
   * 2. 团队成员 → 以容器节点位置为中心，在边界框内布局
   * 3. 普通子Agent → 在所有团队下方布局
   */
  computeTreePositions(subAgents: SubAgentData[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    if (subAgents.length === 0) return positions;

    const mainPos = this.getMainAgentPosition();

    // Step 1: 分离不同类型的 agent
    const teamContainerNodes = subAgents.filter(a => a.id.startsWith('team-'));
    const teamMembers = subAgents.filter(a => a.multiAgent?.teamName && !a.id.startsWith('team-'));
    const regularAgents = subAgents.filter(a => !a.multiAgent?.teamName && !a.id.startsWith('team-'));

    // Step 2: team 容器节点 → 树形布局（获取 X 坐标，Y 将在 Step 3 按策略动态计算）
    if (teamContainerNodes.length > 0) {
      // 使用临时 Y 坐标获取 X 位置，真正的 Y 将在团队循环中按策略重新计算
      this.layoutNonTeamAgents(teamContainerNodes, mainPos, positions, mainPos.y + 300);
    }

    // Step 3: 按 teamName 分组团队成员
    const teamGroups = this.groupByTeam(teamMembers);
    const teamBoundsData: Array<{ teamName: string; members: SubAgentData[]; minX: number; maxX: number; minY: number; maxY: number }> = [];

    // 为团队计算默认 Y 偏移（所有团队从同一个起始 Y 开始）
    let teamYOffset = mainPos.y + this.config.mainRadius + 80;

    teamGroups.forEach((members, teamName) => {
      // 找到对应的 team 容器节点（通过 multiAgent.teamName 匹配）
      const containerNode = teamContainerNodes.find(
        a => a.multiAgent?.teamName === teamName
      );

      const strategy = members[0].multiAgent?.strategy as TeamStrategy | undefined;
      const centerToTop = this.getTeamCenterToTopDistance(strategy || 'parallel', members.length);

      let teamCenter: Point;

      if (containerNode) {
        const containerPos = positions.get(containerNode.id);
        if (containerPos) {
          containerPos.y = teamYOffset + centerToTop;
          positions.set(containerNode.id, containerPos);
          teamCenter = containerPos;
        } else {
          // 容器节点在树布局中没有位置，基于主 agent 计算中心
          teamCenter = { x: mainPos.x, y: teamYOffset + centerToTop };
        }
      } else {
        // 无容器节点时，直接基于主 agent 计算团队中心位置
        teamCenter = { x: mainPos.x, y: teamYOffset + centerToTop };
      }

      // 在边界框内布局团队成员
      const teamPositions = this.layoutTeam(members, teamCenter, 0, 1);
      teamPositions.forEach((pos, agentId) => {
        positions.set(agentId, pos);
      });

      // 估算边界框尺寸
      const { width: teamWidth, height: teamHeight } = this.estimateTeamSize(members.length, strategy);

      teamBoundsData.push({
        teamName,
        members,
        minX: teamCenter.x - teamWidth / 2,
        maxX: teamCenter.x + teamWidth / 2,
        minY: teamCenter.y - teamHeight / 2,
        maxY: teamCenter.y + teamHeight / 2,
      });

      // 累加 Y 偏移，防止多个团队重叠
      teamYOffset += teamHeight + 60; // 团队高度 + 间距
    });

    // Step 4: 普通子Agent → 在所有团队下方布局
    if (regularAgents.length > 0) {
      const maxTeamY = teamBoundsData.length > 0
        ? Math.max(...teamBoundsData.map(b => b.maxY))
        : mainPos.y + 150;
      const startY = maxTeamY + 80;
      this.layoutNonTeamAgents(regularAgents, mainPos, positions, startY);
    }

    return positions;
  }

  /**
   * 按团队分组
   */
  private groupByTeam(subAgents: SubAgentData[]): Map<string, SubAgentData[]> {
    const teams = new Map<string, SubAgentData[]>();


    subAgents.forEach(agent => {
      // 🔧 排除 team 容器节点（id 以 "team-" 开头），避免团队边界框将容器节点自身也包裹进去
      // team 容器节点应由 WorkspaceMonitor 作为团队标题栏渲染，而非作为团队成员参与布局
      if (agent.multiAgent?.teamName && !agent.id.startsWith('team-')) {
        const teamKey = agent.multiAgent.teamName;
        if (!teams.has(teamKey)) {
          teams.set(teamKey, []);
        }
        teams.get(teamKey)!.push(agent);
      }
    });

    teams.forEach((members, teamName) => {
    });

    return teams;
  }

  /**
   * 估算团队边界框尺寸（根据成员数量和策略）
   * 考虑 timeline 和 tool stack 的宽度，防止右侧元素溢出遮挡
   */
  private estimateTeamSize(memberCount: number, strategy?: TeamStrategy): { width: number; height: number } {
    const nodeWidth = 80;
    const nodeHeight = 60;
    const minGap = 210; // 与 layoutParallel/layoutPipeline/layoutHierarchical 保持一致

    switch (strategy) {
      case 'sequential':
        return { width: Math.max(nodeWidth + 100, 300), height: memberCount * 170 + 50 };
      case 'debate': {
        const baseRadius = 180;
        const radiusPerMember = 15;
        const debateRadius = baseRadius + Math.max(0, memberCount - 3) * radiusPerMember;
        const spaceNeeded = (debateRadius + 25 + 220) * 2;
        return { width: spaceNeeded, height: spaceNeeded };
      }
      case 'hierarchical':
        // Workers 水平排列，间距 = max(200 + toolStackExtra, 250)，这里用 250 下限估算
        return { width: Math.max(300, (memberCount - 1) * 250 + nodeWidth + 120), height: 280 };
      case 'pipeline':
        return { width: memberCount * minGap + nodeWidth + 80, height: nodeHeight + 100 };
      case 'parallel':
      default:
        return { width: memberCount * minGap + nodeWidth + 80, height: nodeHeight + 100 };
    }
  }

  /**
   * 计算团队中心到边界框顶部的距离（含 paddingTop）
   * 不同策略的成员布局方式不同，因此该距离因策略而异。
   */
  private getTeamCenterToTopDistance(strategy: TeamStrategy, memberCount: number): number {
    const paddingTop = 60;
    const nodeRadius = this.config.subRadius; // 25

    switch (strategy) {
      case 'debate': {
        const baseRadius = 180;
        const radiusPerMember = 15;
        const debateRadius = baseRadius + Math.max(0, memberCount - 3) * radiusPerMember;
        // 成员环形布局：圆心到顶部成员的距离 = debateRadius
        return debateRadius + paddingTop;
      }
      case 'sequential': {
        // 垂直排列：间距 170px，半高 = (memberCount - 1) * 85
        return (memberCount - 1) * 85 + paddingTop;
      }
      case 'hierarchical': {
        // Leader 在上方垂直间距 100px
        return 100 + nodeRadius + paddingTop;
      }
      case 'pipeline': {
        // 水平排列
        return nodeRadius + paddingTop;
      }
      case 'parallel':
      default: {
        // 水平排列：所有成员同一行
        return nodeRadius + paddingTop;
      }
    }
  }

  /**
   * 为团队应用策略布局
   */
  private layoutTeam(
    members: SubAgentData[],
    center: Point,
    teamIndex: number,
    totalTeams: number
  ): Map<string, Point> {
    const positions = new Map<string, Point>();
    if (members.length === 0) return positions;

    const strategy = members[0].multiAgent?.strategy as TeamStrategy | undefined;

    // 🔧 直接使用传入的 center，不再重新计算
    switch (strategy) {
      case 'sequential':
        return this.layoutSequential(members, center);
      case 'debate':
        return this.layoutDebate(members, center);
      case 'hierarchical':
        return this.layoutHierarchical(members, center);
      case 'pipeline':
        return this.layoutPipeline(members, center);
      case 'parallel':
        return this.layoutParallel(members, center);
      default:
        // 默认水平布局
        return this.layoutParallel(members, center);
    }
  }

  /**
   * Sequential 布局：垂直排列，带序号
   * 固定间距，预留 timeline + currentMoment 空间，避免执行时跳动
   */
  private layoutSequential(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...members].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    // 垂直间距需容纳 agent 圆 + timeline strip + tool stack + 安全间距
    const verticalGap = 170;
    const startY = center.y - ((sorted.length - 1) * verticalGap) / 2;

    sorted.forEach((agent, index) => {
      const key = this.getStableKey(agent);
      const cached = this.positionCache.get(key);
      if (cached) {
        positions.set(agent.id, cached);
      } else {
        const pos = { x: center.x, y: startY + index * verticalGap };
        this.positionCache.set(key, pos);
        positions.set(agent.id, pos);
      }
    });

    return positions;
  }

  /**
   * Debate 布局：环形排列
   * 🔧 优化：增加半径，为气泡留出更多空间
   */
  private layoutDebate(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...members].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    const baseRadius = 180;
    const radiusPerMember = 15;
    const radius = baseRadius + Math.max(0, sorted.length - 3) * radiusPerMember;
    const angleStep = (2 * Math.PI) / sorted.length;

    sorted.forEach((agent, index) => {
      const key = this.getStableKey(agent);
      const cached = this.positionCache.get(key);
      if (cached) {
        positions.set(agent.id, cached);
      } else {
        const angle = index * angleStep - Math.PI / 2;
        const pos = {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        };
        this.positionCache.set(key, pos);
        positions.set(agent.id, pos);
      }
    });

    return positions;
  }

  /**
   * Hierarchical 布局：Leader 在上，Workers 在下水平排列
   *
   * 间距需容纳 agent 节点 + timeline (150px 宽) + currentMoment 标签 (~100px)，
   * 确保 timeline 不被相邻成员的节点遮挡，又不预留过多空白。
   * 最小间距 = agentRadius*2 + timeline半宽 + tagWidth + margin ≈ 50 + 75 + 100 + 25 = 250
   */
  private layoutHierarchical(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...members].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    const leader = sorted[0];
    const workers = sorted.slice(1);

    // Leader 位置
    const leaderKey = this.getStableKey(leader);
    const cachedLeader = this.positionCache.get(leaderKey);
    if (cachedLeader) {
      positions.set(leader.id, cachedLeader);
    } else {
      const pos = { x: center.x, y: center.y - 80 };
      this.positionCache.set(leaderKey, pos);
      positions.set(leader.id, pos);
    }

    // Workers 水平排列 — 间距需足够容纳 timeline 不遮挡相邻节点
    if (workers.length > 0) {
      const maxTimelineCount = Math.max(0, ...workers.map(a => a.timelineEvents?.length || 0));
      const toolStackExtra = Math.min(maxTimelineCount, 4) * 30;
      // timeline 总占用 = agent 半径(25) * 6 = 150px，居中于节点
      // currentMoment 标签在节点右侧 ~137px
      // 最小间距确保 timeline + tag 不侵入相邻节点的 agent 圆形区域
      const timelineReserve = 250;
      const workerSpacing = Math.max(200 + toolStackExtra, timelineReserve);
      const totalWidth = (workers.length - 1) * workerSpacing;
      const startX = center.x - totalWidth / 2;

      workers.forEach((agent, index) => {
        const key = this.getStableKey(agent);
        const cached = this.positionCache.get(key);
        if (cached) {
          positions.set(agent.id, cached);
        } else {
          const pos = { x: startX + index * workerSpacing, y: center.y + 80 };
          this.positionCache.set(key, pos);
          positions.set(agent.id, pos);
        }
      });
    }

    return positions;
  }

  /**
   * Pipeline 布局：水平流程图
   * 间距与 Parallel 保持一致
   */
  private layoutPipeline(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...members].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    const maxTimelineCount = Math.max(0, ...sorted.map(a => a.timelineEvents?.length || 0));
    const toolStackExtra = Math.min(maxTimelineCount, 4) * 30;
    const minTimelineGap = 210;
    const horizontalGap = Math.max(180 + toolStackExtra, minTimelineGap);
    const startX = center.x - ((sorted.length - 1) * horizontalGap) / 2;

    sorted.forEach((agent, index) => {
      const key = this.getStableKey(agent);
      const cached = this.positionCache.get(key);
      if (cached) {
        positions.set(agent.id, cached);
      } else {
        const pos = { x: startX + index * horizontalGap, y: center.y };
        this.positionCache.set(key, pos);
        positions.set(agent.id, pos);
      }
    });

    return positions;
  }

  /**
   * Parallel 布局：水平排列
   *
   * 间距恰好容纳 timeline + currentMoment 标签，不预留多余空白。
   * timeline 半宽 = agentRadius * 3 = 75px，tag 最右点 ≈ agentRadius + gap + tagWidth = 137px
   * 最小间距 = tagRight + agentRadius + margin ≈ 137 + 25 + 15 = 177 → 取 190 确保不拥挤
   */
  private layoutParallel(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...members].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    const maxTimelineCount = Math.max(0, ...sorted.map(a => a.timelineEvents?.length || 0));
    const toolStackExtra = Math.min(maxTimelineCount, 4) * 30;
    // timeline 总宽 150px 居中于节点 + currentMoment 标签在右侧
    // 最小间距确保所有元素不被相邻节点遮挡
    const minTimelineGap = 210;
    const horizontalGap = Math.max(180 + toolStackExtra, minTimelineGap);

    const totalWidth = (sorted.length - 1) * horizontalGap;
    const startX = center.x - totalWidth / 2;

    sorted.forEach((agent, index) => {
      const key = this.getStableKey(agent);
      const cached = this.positionCache.get(key);
      if (cached) {
        positions.set(agent.id, cached);
      } else {
        const pos = { x: startX + index * horizontalGap, y: center.y };
        this.positionCache.set(key, pos);
        positions.set(agent.id, pos);
      }
    });

    return positions;
  }

  /**
   * 布局非团队成员（普通子 agent）
   */
  private layoutNonTeamAgents(
    agents: SubAgentData[],
    mainPos: Point,
    existingPositions: Map<string, Point>,
    startY: number
  ): void {
    // 按稳定键排序，确保多轮后位置不变
    const sorted = [...agents].sort((a, b) => this.getStableKey(a).localeCompare(this.getStableKey(b)));

    const baseCellWidth = 150;
    const maxTimelineCount = Math.max(0, ...sorted.map(a => a.timelineEvents?.length || 0));
    const toolStackExtra = Math.min(maxTimelineCount, 4) * 30;
    const cellWidth = baseCellWidth + toolStackExtra;

    const totalWidth = (sorted.length - 1) * cellWidth;
    const startX = mainPos.x - totalWidth / 2;

    sorted.forEach((agent, index) => {
      const key = this.getStableKey(agent);
      const cached = this.positionCache.get(key);
      if (cached) {
        existingPositions.set(agent.id, cached);
      } else {
        const pos = { x: startX + index * cellWidth, y: startY };
        this.positionCache.set(key, pos);
        existingPositions.set(agent.id, pos);
      }
    });
  }

  /**
   * 计算团队边界框
   */
  computeTeamBoundaries(subAgents: SubAgentData[], positions: Map<string, Point>): TeamBoundary[] {
    const boundaries: TeamBoundary[] = [];
    const teamGroups = this.groupByTeam(subAgents);

    // 🔧 获取主 agent 的位置和尺寸，确保团队边界框不会遮挡主 agent
    const mainPos = this.getMainAgentPosition();
    const mainRadius = this.getMainAgentRadius();
    // 主 agent 占用区域的底部边界（圆形 + 名字标签 + 安全间距）
    // 名字标签高度约20px，再加30px安全间距
    const mainOccupiedBottom = mainPos.y + mainRadius + 50;

    teamGroups.forEach((members, teamName) => {
      if (members.length === 0) return;

      const strategy = members[0].multiAgent?.strategy as TeamStrategy | undefined;
      const memberIds = members.map(m => m.id);

      // 计算包围所有成员的边界框
      const memberPositions = memberIds
        .map(id => positions.get(id))
        .filter(p => p !== undefined) as Point[];

      if (memberPositions.length === 0) return;

      const paddingX = 70;
      const paddingTop = 60;
      const paddingBottom = 100;

      const minX = Math.min(...memberPositions.map(p => p.x)) - paddingX;
      const maxX = Math.max(...memberPositions.map(p => p.x)) + paddingX;
      let minY = Math.min(...memberPositions.map(p => p.y)) - paddingTop;
      const maxY = Math.max(...memberPositions.map(p => p.y)) + paddingBottom;

      // 确保团队边界框顶部不会侵入主 agent 区域
      if (minY < mainOccupiedBottom) {
        minY = mainOccupiedBottom;
      }

      // 找到 Leader（Hierarchical 专用）
      let leaderId: string | undefined;
      if (strategy === 'hierarchical' && members.length > 0) {
        leaderId = members[0].id;
      }

      // 获取轮次信息（Debate 专用）
      let currentRound: number | undefined;
      let maxRounds: number | undefined;
      if (strategy === 'debate') {
        // 🔧 从任意成员的 multiAgent 数据中提取轮次信息
        // 优先使用 currentRound，如果没有则使用 stepIndex（兼容旧数据）
        const firstMember = members[0];
        currentRound = firstMember.multiAgent?.currentRound;
        maxRounds = firstMember.multiAgent?.maxRounds;

      }

      // 🔧 获取团队目标（优先从 multiAgent.goal，其次从第一个成员的 task 中提取）
      let goal: string | undefined;
      if (members.length > 0) {
        goal = members[0].multiAgent?.goal || members[0].task;
      }

      // 🔧 为团队标题预留空间（标题在虚线上方）
      const titleHeight = 32;

      // 🔧 使用成员的 parentAgentId 作为 teamId，确保与 team 容器节点 ID 一致
      const parentTeamNodeId = members[0]?.parentAgentId || `team-${teamName}`;

      boundaries.push({
        teamId: parentTeamNodeId,
        teamName,
        strategy: strategy || 'parallel',
        memberIds,
        bounds: {
          x: minX,
          y: minY - titleHeight, // 向上扩展，为标题留出空间
          width: maxX - minX,
          height: maxY - minY + titleHeight, // 高度包含标题
        },
        leaderId,
        currentRound,
        maxRounds,
        goal, // 🔧 添加 goal 字段
      });
    });

    return boundaries;
  }

  // ─── 工具函数 ──────────────────────────────────────────────

  bezierInterpolate(start: Point, control: Point, end: Point, t: number): Point {
    const t2 = t * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    return {
      x: mt2 * start.x + 2 * mt * t * control.x + t2 * end.x,
      y: mt2 * start.y + 2 * mt * t * control.y + t2 * end.y,
    };
  }

  distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  isPointInCircle(point: Point, circle: Point, radius: number): boolean {
    return this.distance(point, circle) <= radius;
  }
}
