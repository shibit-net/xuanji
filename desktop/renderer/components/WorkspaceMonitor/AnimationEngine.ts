// ============================================================
// Workspace Monitor - 动画引擎
// ============================================================

import type { Animation, Point, Particle, Path } from './types';
import type { LayoutEngine } from './LayoutEngine';

export class AnimationEngine {
  private animations: Map<string, Animation> = new Map();
  private particles: Map<string, Particle[]> = new Map();
  private layoutEngine: LayoutEngine;

  constructor(layoutEngine: LayoutEngine) {
    this.layoutEngine = layoutEngine;
  }

  /**
   * 注册动画
   */
  register(animation: Animation) {
    this.animations.set(animation.id, animation);
  }

  /**
   * 移除动画
   */
  remove(id: string) {
    this.animations.delete(id);
  }

  /**
   * 更新所有动画
   */
  update(currentTime: number, deltaTime: number) {
    const toRemove: string[] = [];

    this.animations.forEach((anim, id) => {
      const elapsed = currentTime - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);

      anim.update(progress, deltaTime);

      if (anim.isComplete()) {
        toRemove.push(id);
      }
    });

    // 清理完成的动画
    toRemove.forEach((id) => this.animations.delete(id));
  }

  /**
   * 绘制所有动画
   */
  draw(ctx: CanvasRenderingContext2D) {
    this.animations.forEach((anim) => {
      if (anim.draw) {
        anim.draw(ctx);
      }
    });
  }

  /**
   * 创建脉冲动画（用于 thinking 状态）
   */
  createPulseAnimation(id: string, center: Point, baseRadius: number): Animation {
    return {
      id: `pulse-${id}`,
      startTime: Date.now(),
      duration: Infinity, // 持续动画
      update: () => {
        // 使用正弦波实现脉冲效果
        // 这里不直接修改对象，而是在绘制时使用
      },
      draw: (ctx) => {
        const scale = 1 + 0.1 * Math.sin(Date.now() / 500);
        const radius = baseRadius * scale;

        // 绘制脉冲光环（使用璇玑的 primary 色）
        const gradient = ctx.createRadialGradient(
          center.x,
          center.y,
          radius * 0.8,
          center.x,
          center.y,
          radius * 1.2
        );
        gradient.addColorStop(0, 'rgba(124, 140, 245, 0)');
        gradient.addColorStop(0.5, 'rgba(124, 140, 245, 0.3)');
        gradient.addColorStop(1, 'rgba(124, 140, 245, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius * 1.2, 0, 2 * Math.PI);
        ctx.fill();
      },
      isComplete: () => false, // 永不完成
    };
  }

  /**
   * 创建旋转动画（用于 executing 状态）
   */
  createRotateAnimation(id: string, center: Point, radius: number): Animation {
    return {
      id: `rotate-${id}`,
      startTime: Date.now(),
      duration: Infinity,
      update: () => {},
      draw: (ctx) => {
        const angle = (Date.now() / 2000) * 2 * Math.PI;

        // 绘制旋转光环（使用璇玑的 success 色）
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius + 10, angle, angle + Math.PI);
        ctx.stroke();
      },
      isComplete: () => false,
    };
  }

  /**
   * 创建闪烁动画（用于 waiting 状态）
   */
  createBlinkAnimation(id: string, center: Point, radius: number): Animation {
    return {
      id: `blink-${id}`,
      startTime: Date.now(),
      duration: Infinity,
      update: () => {},
      draw: (ctx) => {
        const opacity = 0.3 + 0.7 * Math.abs(Math.sin(Date.now() / 400));

        // 绘制闪烁光环（使用璇玑的 warning 色）
        ctx.strokeStyle = `rgba(251, 191, 36, ${opacity})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius + 8, 0, 2 * Math.PI);
        ctx.stroke();
      },
      isComplete: () => false,
    };
  }

  /**
   * 创建抖动动画（用于 error 状态）
   */
  createShakeAnimation(id: string, center: Point, duration: number = 500): Animation {
    const originalX = center.x;
    const startTime = Date.now();

    return {
      id: `shake-${id}`,
      startTime,
      duration,
      update: () => {},
      draw: () => {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
          const offset = 3 * Math.sin((elapsed / duration) * Math.PI * 10);
          center.x = originalX + offset;
        } else {
          center.x = originalX;
        }
      },
      isComplete: () => Date.now() - startTime >= duration,
    };
  }

  /**
   * 创建粒子流动动画（用于工具执行）
   */
  createParticleFlowAnimation(
    id: string,
    path: Path,
    color: string = '#34D399', // 使用璇玑的 success 色
    particleCount: number = 5
  ): Animation {
    const particles: Particle[] = [];

    // 检查 path.points 是否有效
    if (!path.points || path.points.length < 2) {
      console.warn('[AnimationEngine] 无效的路径，无法创建粒子动画');
      return {
        id: `particle-${id}`,
        startTime: Date.now(),
        duration: Infinity,
        update: () => {},
        draw: () => {},
        isComplete: () => false,
      };
    }

    // 初始化粒子
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: path.points[0].x,
        y: path.points[0].y,
        progress: i / particleCount,
        opacity: 1,
      });
    }

    this.particles.set(id, particles);

    return {
      id: `particle-${id}`,
      startTime: Date.now(),
      duration: Infinity,
      update: (_progress, deltaTime) => {
        const speed = 0.3; // 每秒移动 30% 的路径
        particles.forEach((p) => {
          p.progress += (speed * deltaTime) / 1000;
          if (p.progress > 1) {
            p.progress = 0; // 循环
          }

          // 沿着多段直线移动
          const pos = this.interpolateAlongPath(path.points, p.progress);
          p.x = pos.x;
          p.y = pos.y;
        });
      },
      draw: (ctx) => {
        particles.forEach((p) => {
          ctx.fillStyle = color;
          ctx.globalAlpha = p.opacity || 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
          ctx.fill();
          ctx.globalAlpha = 1;
        });
      },
      isComplete: () => false,
    };
  }

  /**
   * 沿着多段直线插值
   */
  private interpolateAlongPath(points: Point[], progress: number): Point {
    if (points.length < 2) {
      return points[0] || { x: 0, y: 0 };
    }

    // 计算每段的长度
    const segments: { start: Point; end: Point; length: number }[] = [];
    let totalLength = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const length = Math.sqrt(
        Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
      );
      segments.push({ start, end, length });
      totalLength += length;
    }

    // 根据 progress 找到对应的段
    let targetLength = progress * totalLength;
    let accumulatedLength = 0;

    for (const segment of segments) {
      if (accumulatedLength + segment.length >= targetLength) {
        // 在这一段上
        const segmentProgress = (targetLength - accumulatedLength) / segment.length;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * segmentProgress,
          y: segment.start.y + (segment.end.y - segment.start.y) * segmentProgress,
        };
      }
      accumulatedLength += segment.length;
    }

    // 如果超出范围，返回最后一个点
    return points[points.length - 1];
  }

  /**
   * 创建 Token 增量动画
   */
  createTokenDeltaAnimation(
    id: string,
    position: Point,
    delta: number,
    duration: number = 1000
  ): Animation {
    const startTime = Date.now();
    const startY = position.y;

    return {
      id: `token-delta-${id}`,
      startTime,
      duration,
      update: () => {},
      draw: (ctx) => {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
          const y = startY - progress * 20; // 向上移动 20px
          const opacity = 1 - progress;

          ctx.fillStyle = delta > 0 ? `rgba(52, 211, 153, ${opacity})` : `rgba(248, 113, 113, ${opacity})`;
          ctx.font = '12px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`${delta > 0 ? '+' : ''}${delta}`, position.x, y);
        }
      },
      isComplete: () => Date.now() - startTime >= duration,
    };
  }

  /**
   * 清理所有动画
   */
  clear() {
    this.animations.clear();
    this.particles.clear();
  }

  /**
   * 获取当前动画数量
   */
  getAnimationCount(): number {
    return this.animations.size;
  }
}
