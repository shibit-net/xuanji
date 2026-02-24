// ============================================================
// M1 终端 UI — 启动 Logo 动画
// ============================================================
//
// 设计：星空背景 + 旋转银河 + 双星系统

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface StartupLogoProps {
  onComplete?: () => void;
  duration?: number; // 动画持续时间（毫秒），默认 3000ms
}

/**
 * 生成旋转银河的一帧
 * @param frame 当前帧数（0-359）
 */
function generateGalaxy(frame: number): string[] {
  const width = 60;
  const height = 12;
  const centerX = width / 2;
  const centerY = height / 2;

  // 初始化空白画布
  const canvas: string[][] = Array(height).fill(null).map(() => Array(width).fill(' '));

  // 星空背景
  const stars = [
    [5, 2], [50, 1], [10, 9], [55, 8], [15, 3], [45, 10],
    [8, 6], [52, 4], [20, 1], [40, 11], [12, 8], [48, 2]
  ];
  stars.forEach(([x, y]) => {
    if (x < width && y < height) {
      canvas[y][x] = '·';
    }
  });

  // 银河旋臂（3条）
  const armCount = 3;
  const starsPerArm = 12;

  for (let arm = 0; arm < armCount; arm++) {
    const armAngleOffset = (arm * 360 / armCount) * Math.PI / 180;

    for (let i = 0; i < starsPerArm; i++) {
      const distance = (i / starsPerArm) * 15;
      const angle = (frame + i * 15) * Math.PI / 180 + armAngleOffset;

      const x = Math.round(centerX + distance * Math.cos(angle));
      const y = Math.round(centerY + distance * Math.sin(angle) * 0.4);

      if (x >= 0 && x < width && y >= 0 && y < height) {
        const brightness = 1 - (i / starsPerArm);
        const chars = ['·', '∘', '○', '◉'];
        canvas[y][x] = chars[Math.floor(brightness * chars.length)];
      }
    }
  }

  // 中心双星
  const star1X = Math.round(centerX + 1.5 * Math.cos(frame * 3 * Math.PI / 180));
  const star1Y = Math.round(centerY + 0.6 * Math.sin(frame * 3 * Math.PI / 180));
  const star2X = Math.round(centerX - 1.5 * Math.cos(frame * 3 * Math.PI / 180));
  const star2Y = Math.round(centerY - 0.6 * Math.sin(frame * 3 * Math.PI / 180));

  const brightness1 = 0.5 + 0.5 * Math.sin(frame * 5 * Math.PI / 180);
  const brightness2 = 0.5 + 0.5 * Math.cos(frame * 5 * Math.PI / 180);

  if (star1X >= 0 && star1X < width && star1Y >= 0 && star1Y < height) {
    canvas[star1Y][star1X] = brightness1 > 0.7 ? '★' : '☆';
  }
  if (star2X >= 0 && star2X < width && star2Y >= 0 && star2Y < height) {
    canvas[star2Y][star2X] = brightness2 > 0.7 ? '★' : '☆';
  }

  // 水印 "Shibit 璇玑"
  const watermark = 'Shibit 璇玑';
  const watermarkY = height - 2;
  const watermarkX = Math.floor((width - 13) / 2); // 大约居中
  if (watermarkY >= 0 && watermarkY < height) {
    for (let i = 0; i < watermark.length && watermarkX + i < width; i++) {
      canvas[watermarkY][watermarkX + i] = watermark[i];
    }
  }

  // 转换为字符串数组
  return canvas.map(row => row.join(''));
}

/**
 * StartupLogo — 启动动画：星空 + 旋转银河 + 双星系统
 */
export function StartupLogo({ onComplete, duration = 3000 }: StartupLogoProps) {
  const [frame, setFrame] = useState(0);
  const [showTitle, setShowTitle] = useState(false);

  useEffect(() => {
    // 旋转动画
    const timer = setInterval(() => {
      setFrame(prev => (prev + 3) % 360);
    }, 50); // 20 FPS

    // 标题延迟显示
    const titleTimer = setTimeout(() => {
      setShowTitle(true);
    }, 800);

    // 动画完成回调
    const completeTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, duration);

    return () => {
      clearInterval(timer);
      clearTimeout(titleTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  const galaxy = generateGalaxy(frame);

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      {/* 星空 + 银河 */}
      <Box flexDirection="column" borderStyle="round" borderColor="#7C8CF5" paddingX={1} paddingY={1}>
        {galaxy.map((line, i) => (
          <Text key={i} color="#A78BFA">{line}</Text>
        ))}
      </Box>

      {/* 标题 */}
      {showTitle && (
        <Box marginTop={1}>
          <Text bold color="#7C8CF5">✦ Shibit Xuanji · 璇玑</Text>
        </Box>
      )}
    </Box>
  );
}
