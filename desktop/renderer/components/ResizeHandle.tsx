// ============================================================
// ResizeHandle - 可拖拽的垂直分隔条
// ============================================================
// 功能：
// - 支持鼠标拖拽调整左右面板宽度
// - 提供视觉反馈（hover/dragging状态）
// - 限制最小/最大宽度
// ============================================================

import React, { useRef, useState, useEffect } from 'react';

interface ResizeHandleProps {
  /**
   * 拖拽方向
   * - 'left': 拖拽改变左侧面板宽度
   * - 'right': 拖拽改变右侧面板宽度
   */
  direction: 'left' | 'right';

  /**
   * 当前面板宽度（px）
   */
  width: number;

  /**
   * 宽度变化回调
   */
  onResize: (newWidth: number) => void;

  /**
   * 最小宽度（px），默认 200
   */
  minWidth?: number;

  /**
   * 最大宽度（px），默认 600
   */
  maxWidth?: number;

  /**
   * 分隔条宽度（px），默认 4
   */
  handleWidth?: number;
}

export default function ResizeHandle({
  direction,
  width,
  onResize,
  minWidth = 200,
  maxWidth = 600,
  handleWidth = 4,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();

      const deltaX = e.clientX - startXRef.current;
      const newWidth = direction === 'left'
        ? startWidthRef.current + deltaX
        : startWidthRef.current - deltaX;

      // 限制在最小/最大宽度范围内
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      onResize(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, minWidth, maxWidth, onResize]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      className={`relative flex-shrink-0 group`}
      style={{ width: `${handleWidth}px` }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 分隔线 */}
      <div
        className={`absolute inset-y-0 left-0 w-px transition-colors ${
          isDragging
            ? 'bg-primary'
            : isHovered
            ? 'bg-primary/60'
            : 'bg-muted'
        }`}
      />

      {/* 可点击区域（扩大交互范围） */}
      <div
        className="absolute inset-0 cursor-col-resize"
        style={{ marginLeft: '-4px', marginRight: '-4px' }}
      />

      {/* Hover 提示（中间的抓手图标） */}
      {(isHovered || isDragging) && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="flex items-center gap-0.5 px-1 py-2 bg-primary/20 rounded border border-primary/40">
            <div className="w-0.5 h-4 bg-primary/60 rounded-full" />
            <div className="w-0.5 h-4 bg-primary/60 rounded-full" />
          </div>
        </div>
      )}
    </div>
  );
}
