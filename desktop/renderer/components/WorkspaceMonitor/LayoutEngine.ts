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
      orbitRadius: 150,
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
   * 获取主 Agent 位置
   */
  getMainAgentPosition(): Point {
    return {
      x: this.config.centerX,
      y: this.config.centerY,
    };
  }

  /**
   * 获取主 Agent 半径
   */
  getMainAgentRadius(): number {
    return this.config.mainRadius;
  }

  /**
   * 计算子 Agent 位置（圆形布局）
   * @param index 子 Agent 索引
   * @param total 子 Agent 总数
   */
  getSubAgentPosition(index: number, total: number): Point {
    // 从顶部开始（-90度）
    const angle = (2 * Math.PI / total) * index - Math.PI / 2;
    return {
      x: this.config.centerX + Math.cos(angle) * this.config.orbitRadius,
      y: this.config.centerY + Math.sin(angle) * this.config.orbitRadius,
    };
  }

  /**
   * 获取子 Agent 半径
   */
  getSubAgentRadius(): number {
    return this.config.subRadius;
  }

  /**
   * 计算连接线路径（贝塞尔曲线）
   */
  getConnectionPath(from: Point, to: Point): Path {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const controlOffset = 30;

    return {
      start: from,
      control: { x: midX, y: midY - controlOffset },
      end: to,
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
