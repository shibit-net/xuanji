// ============================================================
// Workspace Monitor - 布局引擎
// ============================================================

import type { Point, Path, LayoutConfig } from './types';

export class LayoutEngine {
  private config: LayoutConfig;

  constructor(canvasWidth: number, canvasHeight: number) {
    this.config = {
      centerX: canvasWidth / 2,
      centerY: canvasHeight / 2,
      mainRadius: 40,
      subRadius: 25,
      orbitRadius: 150, // 保留，但不再用于圆形布局
      canvasWidth,
      canvasHeight,
    };
  }

  /**
   * 更新画布尺寸
   */
  updateSize(width: number, height: number) {
    this.config.centerX = width / 2;
    this.config.centerY = height / 2;
    this.config.canvasWidth = width;
    this.config.canvasHeight = height;
  }

  /**
   * 获取主 Agent 位置（树状布局：顶部中央）
   */
  getMainAgentPosition(): Point {
    return {
      x: this.config.centerX,
      y: 100, // 距离顶部 100px
    };
  }

  /**
   * 获取主 Agent 半径
   */
  getMainAgentRadius(): number {
    return this.config.mainRadius;
  }

  /**
   * 计算子 Agent 位置（树状布局：底部水平排列，自适应间距）
   * @param index 子 Agent 索引
   * @param total 子 Agent 总数
   */
  getSubAgentPosition(index: number, total: number): Point {
    if (total === 0) {
      return { x: this.config.centerX, y: 300 };
    }

    const verticalOffset = 200; // 主 Agent 和子 Agent 之间的垂直间距
    const padding = 60; // 左右边距
    const subRadius = this.getSubAgentRadius();

    // 计算可用宽度
    const availableWidth = this.config.canvasWidth - padding * 2 - subRadius * 2 * total;

    // 计算间距（理想间距 120px，但不超过可用宽度）
    const idealGap = 120;
    const minGap = 60; // 最小间距
    let horizontalGap = idealGap;

    if (total > 1) {
      const requiredWidth = (total - 1) * idealGap;
      if (requiredWidth > availableWidth) {
        // 需要缩小间距
        horizontalGap = Math.max(minGap, availableWidth / (total - 1));
      }
    }

    // 计算总宽度和起始位置
    const totalWidth = total > 1 ? (total - 1) * horizontalGap : 0;
    const startX = this.config.centerX - totalWidth / 2;

    return {
      x: startX + index * horizontalGap,
      y: 100 + verticalOffset, // 主 Agent Y (100) + 垂直间距
    };
  }

  /**
   * 获取子 Agent 半径
   */
  getSubAgentRadius(): number {
    return this.config.subRadius;
  }

  /**
   * 计算连接线路径（树状布局：垂直 → 水平 → 垂直）
   */
  getConnectionPath(from: Point, to: Point): Path {
    // 计算中间点（垂直方向的中点）
    const midY = (from.y + to.y) / 2;

    return {
      points: [
        from,                      // 起点（主 Agent 底部）
        { x: from.x, y: midY },    // 垂直向下到中间点
        { x: to.x, y: midY },      // 水平移动到子 Agent 的 X 坐标
        to,                        // 垂直向下到子 Agent 顶部
      ],
    };
  }

  /**
   * 计算气泡位置
   * @param agentPos Agent 位置
   * @param agentRadius Agent 半径
   * @param bubbleWidth 气泡宽度
   * @param bubbleHeight 气泡高度
   * @param direction 方向 ('top' | 'right' | 'bottom' | 'left')
   */
  getBubblePosition(
    agentPos: Point,
    agentRadius: number,
    bubbleWidth: number,
    bubbleHeight: number,
    direction: 'top' | 'right' | 'bottom' | 'left' = 'top'
  ): Point {
    const padding = 20;

    switch (direction) {
      case 'top':
        return {
          x: agentPos.x - bubbleWidth / 2,
          y: agentPos.y - agentRadius - bubbleHeight - padding,
        };
      case 'right':
        return {
          x: agentPos.x + agentRadius + padding,
          y: agentPos.y - bubbleHeight / 2,
        };
      case 'bottom':
        return {
          x: agentPos.x - bubbleWidth / 2,
          y: agentPos.y + agentRadius + padding,
        };
      case 'left':
        return {
          x: agentPos.x - agentRadius - bubbleWidth - padding,
          y: agentPos.y - bubbleHeight / 2,
        };
    }
  }

  /**
   * 计算统计区域位置
   */
  getStatsPosition(): Point {
    return {
      x: 20,
      y: this.config.canvasHeight - 60,
    };
  }

  /**
   * 贝塞尔曲线插值
   */
  bezierInterpolate(start: Point, control: Point, end: Point, t: number): Point {
    const t2 = t * t;
    const mt = 1 - t;
    const mt2 = mt * mt;

    return {
      x: mt2 * start.x + 2 * mt * t * control.x + t2 * end.x,
      y: mt2 * start.y + 2 * mt * t * control.y + t2 * end.y,
    };
  }

  /**
   * 计算两点之间的距离
   */
  distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 检查点是否在圆内
   */
  isPointInCircle(point: Point, circle: Point, radius: number): boolean {
    return this.distance(point, circle) <= radius;
  }
}
