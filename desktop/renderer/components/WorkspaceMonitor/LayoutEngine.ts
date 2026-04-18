// ============================================================
// Workspace Monitor - 布局引擎（带碰撞检测 + 策略感知布局）
// ============================================================

import type { Point, Path, Rect, LayoutConfig, SubAgentData, TeamBoundary, TeamStrategy } from './types';

export class LayoutEngine {
  private config: LayoutConfig;
  /** 当前帧已占用的矩形区域，用于碰撞避让 */
  private occupiedRects: Rect[] = [];

  constructor(canvasWidth: number, canvasHeight: number) {
    this.config = {
      centerX: canvasWidth / 2,
      centerY: canvasHeight / 2,
      mainRadius: 40,
      subRadius: 25,
      orbitRadius: 150,
      canvasWidth,
      canvasHeight,
    };
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

  /** 检查矩形是否在 canvas 边界内 */
  private isInBounds(rect: Rect): boolean {
    const pad = 4;
    return (
      rect.x >= pad &&
      rect.y >= pad &&
      rect.x + rect.width <= this.config.canvasWidth - pad &&
      rect.y + rect.height <= this.config.canvasHeight - pad
    );
  }

  /** 将矩形 clamp 到 canvas 内 */
  private clampRect(rect: Rect): Rect {
    const pad = 4;
    let { x, y, width, height } = rect;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    if (x + width > this.config.canvasWidth - pad) x = this.config.canvasWidth - pad - width;
    if (y + height > this.config.canvasHeight - pad) y = this.config.canvasHeight - pad - height;
    return { x, y, width, height };
  }

  // ─── 尺寸 ─────────────────────────────────────────────────

  updateSize(width: number, height: number) {
    this.config.centerX = width / 2;
    this.config.centerY = height / 2;
    this.config.canvasWidth = width;
    this.config.canvasHeight = height;
  }

  getMainAgentRadius(): number {
    return this.config.mainRadius;
  }

  getSubAgentRadius(): number {
    return this.config.subRadius;
  }

  // ─── 主 Agent 位置 ────────────────────────────────────────

  getMainAgentPosition(): Point {
    return {
      x: this.config.centerX,
      y: Math.min(180, this.config.canvasHeight * 0.25),
    };
  }

  // ─── 子 Agent 位置（多行自适应）───────────────────────────

  getSubAgentPosition(index: number, total: number): Point {
    if (total === 0) {
      return { x: this.config.centerX, y: 400 };
    }

    const subRadius = this.getSubAgentRadius();
    const padding = 80; // 左右边距（包含附件空间）
    const mainY = this.getMainAgentPosition().y;
    const verticalGap = 180; // 主→子垂直间距

    // 计算每行容量
    const cellWidth = 160; // 每个节点占用宽度（节点+附件+间距）
    const usableWidth = this.config.canvasWidth - padding * 2;
    const perRow = Math.max(1, Math.floor(usableWidth / cellWidth));

    // 行列计算
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const colsInRow = Math.min(perRow, total - row * perRow); // 这一行的实际列数

    // 居中排列
    const rowWidth = (colsInRow - 1) * cellWidth;
    const startX = this.config.centerX - rowWidth / 2;

    const x = startX + col * cellWidth;
    const y = mainY + verticalGap + row * 140; // 行间距 140

    // clamp 到 canvas 内
    return {
      x: Math.max(padding, Math.min(x, this.config.canvasWidth - padding)),
      y: Math.max(subRadius + 10, Math.min(y, this.config.canvasHeight - subRadius - 60)),
    };
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
  ): Point {
    const gap = 30; // 🔧 增大基础间距，避免气泡遮挡其他节点

    // 🔧 候选位置优先级：上 → 左 → 右 → 下 → 对角线 → 更远位置
    const candidates: Point[] = [
      // 🔧 第一优先级：上方（水平居中）- 优先向上，避免遮挡下方节点
      { x: agentPos.x - bubbleWidth / 2, y: agentPos.y - agentRadius - gap - bubbleHeight },

      // 第二优先级：左右两侧（垂直居中）
      { x: agentPos.x - agentRadius - gap - bubbleWidth, y: agentPos.y - bubbleHeight / 2 },
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - bubbleHeight / 2 },

      // 第三优先级：下方（水平居中）
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
   */
  getMomentTagPosition(agentPos: Point, agentRadius: number, tagWidth = 100, tagHeight = 24): Point {
    const gap = 8;

    // 候选：右侧 → 左侧
    const candidates: Point[] = [
      { x: agentPos.x + agentRadius + gap, y: agentPos.y - tagHeight / 2 },
      { x: agentPos.x - agentRadius - gap - tagWidth, y: agentPos.y - tagHeight / 2 },
    ];

    for (const pos of candidates) {
      const rect: Rect = { x: pos.x, y: pos.y, width: tagWidth, height: tagHeight };
      const clamped = this.clampRect(rect);
      if (!this.isOverlapping(clamped)) {
        this.addOccupied(clamped);
        return { x: clamped.x, y: clamped.y };
      }
    }

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
    let x = agentPos.x - agentRadius - gap - 4;
    let y = agentPos.y - totalHeight / 2;

    // clamp
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    if (y + totalHeight > this.config.canvasHeight - 10) {
      y = this.config.canvasHeight - 10 - totalHeight;
    }

    return { x, y };
  }

  // ─── 时间条（带边界检查）──────────────────────────────────

  getTimelineOrigin(agentPos: Point, agentRadius: number): Point {
    const gap = 12;
    const timelineWidth = agentRadius * 6;
    let x = agentPos.x - timelineWidth / 2;
    let y = agentPos.y + agentRadius + gap;

    // clamp 水平
    if (x < 10) x = 10;
    if (x + timelineWidth > this.config.canvasWidth - 10) {
      x = this.config.canvasWidth - 10 - timelineWidth;
    }
    // clamp 垂直
    if (y + 24 > this.config.canvasHeight - 10) {
      y = this.config.canvasHeight - 34;
    }

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
   */
  computeTreePositions(subAgents: SubAgentData[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    if (subAgents.length === 0) return positions;

    console.log('[LayoutEngine] computeTreePositions: 开始计算布局，共', subAgents.length, '个 agent');

    const mainPos = this.getMainAgentPosition();

    // 按团队分组（同一个 teamName 的成员）
    const teamGroups = this.groupByTeam(subAgents);

    console.log('[LayoutEngine] 团队分组完成，共', teamGroups.size, '个团队');

    // 🔧 改进：计算每个团队需要的空间，避免重叠
    const teamBounds: Array<{ teamName: string; members: SubAgentData[]; minX: number; maxX: number; minY: number; maxY: number }> = [];

    // 为每个团队应用策略布局
    let teamIndex = 0;

    teamGroups.forEach((team, teamName) => {
      const strategy = team[0].multiAgent?.strategy as TeamStrategy | undefined;

      // 根据策略估算团队所需空间（考虑节点大小 + 标签 + padding）
      let teamWidth = 0;
      let teamHeight = 0;

      const nodeWidth = 80; // 节点宽度
      const nodeHeight = 60; // 节点高度（包含标签）

      switch (strategy) {
        case 'sequential':
          teamWidth = nodeWidth + 100; // 垂直排列，宽度固定 + padding
          teamHeight = team.length * 120 + 100; // 每个成员 120px（增大间距）+ padding
          break;
        case 'debate':
          // 🔧 根据成员数量动态计算所需空间
          const baseRadius = 180; // 与 layoutDebate 保持一致
          const radiusPerMember = 15;
          const debateRadius = baseRadius + Math.max(0, team.length - 3) * radiusPerMember;
          // 需要的空间 = (半径 + 节点半径 + 气泡宽度) * 2
          const spaceNeeded = (debateRadius + 25 + 220) * 2; // 25是节点半径，220是气泡宽度
          teamWidth = spaceNeeded;
          teamHeight = spaceNeeded;
          break;
        case 'hierarchical':
          teamWidth = Math.max(250, (team.length - 1) * 140 + nodeWidth + 100);
          teamHeight = 250; // Leader + Workers 两层，增大垂直间距
          break;
        case 'pipeline':
          teamWidth = team.length * 160 + nodeWidth + 100; // 增大水平间距
          teamHeight = nodeHeight + 100;
          break;
        case 'parallel':
        default:
          teamWidth = team.length * 140 + nodeWidth + 100; // 增大水平间距
          teamHeight = nodeHeight + 100;
          break;
      }

      // 🔧 根据团队数量决定布局策略
      let teamCenterX: number;
      let teamCenterY: number;

      // 计算主 agent 占用的安全区域（包括名称标签）
      const mainRadius = this.getMainAgentRadius();
      const mainSafeZoneBottom = mainPos.y + mainRadius + 50; // 主agent底部 + 名称标签高度 + 安全间距

      if (teamGroups.size === 1) {
        // 单个团队：在主 agent 正下方居中，距离更远
        teamCenterX = mainPos.x;
        // 🔧 增大团队与主 agent 的距离
        teamCenterY = mainSafeZoneBottom + teamHeight / 2 + 80; // 从40增加到80
      } else if (teamGroups.size === 2) {
        // 两个团队：在主 agent 左右两侧，距离更远
        const spacing = 350; // 🔧 从250增加到350
        teamCenterX = teamIndex === 0 ? mainPos.x - spacing : mainPos.x + spacing;
        teamCenterY = mainSafeZoneBottom + teamHeight / 2 + 80; // 从40增加到80
      } else {
        // 3+ 个团队：围绕主 agent 排布（圆形布局），半径更大
        const radius = 450; // 🔧 从350增加到450
        const angleStep = (2 * Math.PI) / teamGroups.size;
        const angle = teamIndex * angleStep - Math.PI / 2; // 从顶部开始（-90度）
        teamCenterX = mainPos.x + radius * Math.cos(angle);
        // 确保所有团队都在安全区域下方
        const calculatedY = mainPos.y + 250 + radius * Math.sin(angle);
        teamCenterY = Math.max(calculatedY, mainSafeZoneBottom + teamHeight / 2 + 80);
      }

      console.log('[LayoutEngine] 团队', teamName, '中心位置:', { x: teamCenterX, y: teamCenterY }, '尺寸:', { width: teamWidth, height: teamHeight });

      const teamPositions = this.layoutTeam(team, { x: teamCenterX, y: teamCenterY }, teamIndex, teamGroups.size);
      teamPositions.forEach((pos, agentId) => {
        positions.set(agentId, pos);
      });

      // 记录团队边界
      teamBounds.push({
        teamName,
        members: team,
        minX: teamCenterX - teamWidth / 2,
        maxX: teamCenterX + teamWidth / 2,
        minY: teamCenterY - teamHeight / 2,
        maxY: teamCenterY + teamHeight / 2,
      });

      // 移动到下一个团队索引
      teamIndex++;
    });

    // 处理非团队成员（没有 multiAgent 信息的普通子 agent）
    const nonTeamAgents = subAgents.filter(a => !a.multiAgent?.teamName);
    console.log('[LayoutEngine] 非团队成员数量:', nonTeamAgents.length);

    if (nonTeamAgents.length > 0) {
      // 🔧 改进：支持混合布局（团队 + 独立agent）
      // 如果有团队，非团队成员放在所有团队下方
      // 如果没有团队，非团队成员直接在主agent下方居中排列
      const maxTeamY = teamBounds.length > 0
        ? Math.max(...teamBounds.map(b => b.maxY))
        : mainPos.y + 150;

      // 🔧 如果既有团队又有独立agent，给它们之间留出足够间距
      const startY = teamBounds.length > 0 ? maxTeamY + 80 : mainPos.y + 200;

      this.layoutNonTeamAgents(nonTeamAgents, mainPos, positions, startY);
    }

    console.log('[LayoutEngine] computeTreePositions: 布局完成，共', positions.size, '个位置');

    return positions;
  }

  /**
   * 按团队分组
   */
  private groupByTeam(subAgents: SubAgentData[]): Map<string, SubAgentData[]> {
    const teams = new Map<string, SubAgentData[]>();

    console.log('[LayoutEngine] groupByTeam: 开始分组，总共', subAgents.length, '个 agent');

    subAgents.forEach(agent => {
      console.log('[LayoutEngine] 检查 agent:', {
        id: agent.id,
        name: agent.name,
        hasMultiAgent: !!agent.multiAgent,
        teamName: agent.multiAgent?.teamName,
        strategy: agent.multiAgent?.strategy,
      });

      if (agent.multiAgent?.teamName) {
        const teamKey = agent.multiAgent.teamName;
        if (!teams.has(teamKey)) {
          teams.set(teamKey, []);
        }
        teams.get(teamKey)!.push(agent);
        console.log('[LayoutEngine] 添加到团队:', teamKey);
      }
    });

    console.log('[LayoutEngine] groupByTeam: 分组完成，共', teams.size, '个团队');
    teams.forEach((members, teamName) => {
      console.log('[LayoutEngine] 团队:', teamName, '成员数:', members.length, '策略:', members[0]?.multiAgent?.strategy);
    });

    return teams;
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

    console.log('[LayoutEngine] layoutTeam: 布局团队', {
      teamIndex,
      totalTeams,
      memberCount: members.length,
      strategy,
      teamName: members[0].multiAgent?.teamName,
      center,
    });

    // 🔧 直接使用传入的 center，不再重新计算
    switch (strategy) {
      case 'sequential':
        console.log('[LayoutEngine] 使用 Sequential 布局');
        return this.layoutSequential(members, center);
      case 'debate':
        console.log('[LayoutEngine] 使用 Debate 布局');
        return this.layoutDebate(members, center);
      case 'hierarchical':
        console.log('[LayoutEngine] 使用 Hierarchical 布局');
        return this.layoutHierarchical(members, center);
      case 'pipeline':
        console.log('[LayoutEngine] 使用 Pipeline 布局');
        return this.layoutPipeline(members, center);
      case 'parallel':
        console.log('[LayoutEngine] 使用 Parallel 布局');
        return this.layoutParallel(members, center);
      default:
        console.log('[LayoutEngine] 使用默认 Parallel 布局（策略未识别）');
        // 默认水平布局
        return this.layoutParallel(members, center);
    }
  }

  /**
   * Sequential 布局：垂直排列，带序号
   */
  private layoutSequential(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();
    const verticalGap = 120; // 增大间距，避免标签重叠
    const startY = center.y - ((members.length - 1) * verticalGap) / 2;

    members.forEach((agent, index) => {
      positions.set(agent.id, {
        x: center.x,
        y: startY + index * verticalGap,
      });
    });

    return positions;
  }

  /**
   * Debate 布局：环形排列
   * 🔧 优化：增加半径，为气泡留出更多空间
   */
  private layoutDebate(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();
    // 🔧 增大半径，避免 agent 标签遮挡中心圆
    // 中心圆半径为 50px，agent 半径为 25px，标签高度约 40px（名称15px + 类型标签20px + 间距）
    // 需要确保 agent 到中心的距离 > 50 + 25 + 40 = 115px
    const baseRadius = 180; // 基础半径从 160 增加到 180
    const radiusPerMember = 15; // 每增加一个成员，半径增加 15px
    const radius = baseRadius + Math.max(0, members.length - 3) * radiusPerMember;
    const angleStep = (2 * Math.PI) / members.length;

    members.forEach((agent, index) => {
      const angle = index * angleStep - Math.PI / 2; // 从顶部开始
      positions.set(agent.id, {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    });

    return positions;
  }

  /**
   * Hierarchical 布局：Leader 在上，Workers 在下水平排列
   */
  private layoutHierarchical(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();

    // 找到 Leader（priority 最高或第一个）
    const leader = members[0];
    const workers = members.slice(1);

    // Leader 位置
    positions.set(leader.id, {
      x: center.x,
      y: center.y - 80, // 增大垂直间距
    });

    // Workers 水平排列
    if (workers.length > 0) {
      const workerSpacing = 140; // 增大水平间距
      const totalWidth = (workers.length - 1) * workerSpacing;
      const startX = center.x - totalWidth / 2;

      workers.forEach((agent, index) => {
        positions.set(agent.id, {
          x: startX + index * workerSpacing,
          y: center.y + 80, // 增大垂直间距
        });
      });
    }

    return positions;
  }

  /**
   * Pipeline 布局：水平流程图
   */
  private layoutPipeline(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();
    const horizontalGap = 160; // 增大间距，为箭头留空间
    const startX = center.x - ((members.length - 1) * horizontalGap) / 2;

    members.forEach((agent, index) => {
      positions.set(agent.id, {
        x: startX + index * horizontalGap,
        y: center.y,
      });
    });

    return positions;
  }

  /**
   * Parallel 布局：水平排列
   */
  private layoutParallel(members: SubAgentData[], center: Point): Map<string, Point> {
    const positions = new Map<string, Point>();
    const horizontalGap = 140; // 增大间距
    const totalWidth = (members.length - 1) * horizontalGap;
    const startX = center.x - totalWidth / 2;

    members.forEach((agent, index) => {
      positions.set(agent.id, {
        x: startX + index * horizontalGap,
        y: center.y,
      });
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
    const padding = 80;
    const cellWidth = 140;

    console.log('[LayoutEngine] layoutNonTeamAgents: 布局非团队成员，startY:', startY);

    // 简单水平布局
    const totalWidth = (agents.length - 1) * cellWidth;
    const startX = mainPos.x - totalWidth / 2;

    agents.forEach((agent, index) => {
      const x = startX + index * cellWidth;
      const pos = {
        x: Math.max(padding, Math.min(x, this.config.canvasWidth - padding)),
        y: startY,
      };
      existingPositions.set(agent.id, pos);
      console.log('[LayoutEngine] 非团队成员位置:', agent.id, pos);
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
      const paddingBottom = 100; // 🔧 增加底部 padding，确保包含 agent 类型标签

      const canvasMargin = 40;

      let minX = Math.min(...memberPositions.map(p => p.x)) - paddingX;
      let maxX = Math.max(...memberPositions.map(p => p.x)) + paddingX;
      let minY = Math.min(...memberPositions.map(p => p.y)) - paddingTop;
      let maxY = Math.max(...memberPositions.map(p => p.y)) + paddingBottom;

      // 🔧 确保团队边界框顶部不会侵入主 agent 区域
      if (minY < mainOccupiedBottom) {
        minY = mainOccupiedBottom;
      }

      // 确保不超出 canvas 边界
      minX = Math.max(canvasMargin, minX);
      maxX = Math.min(this.config.canvasWidth - canvasMargin, maxX);
      minY = Math.max(canvasMargin, minY);
      maxY = Math.min(this.config.canvasHeight - canvasMargin, maxY);

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

        console.log('[LayoutEngine] Debate 轮次信息:', { currentRound, maxRounds });
      }

      // 🔧 获取团队目标（从第一个成员的 task 中提取）
      let goal: string | undefined;
      if (members.length > 0 && members[0].task) {
        goal = members[0].task;
      }

      // 🔧 为团队标题预留空间（标题在虚线上方）
      const titleHeight = 32;

      boundaries.push({
        teamId: `team-${teamName}`,
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
