// ============================================================
// Avatar - 头像组件
// 使用 DiceBear 根据 seed 生成一致的头像
// 如果有 url 则优先显示 url（用户设置的头像）
// ============================================================

import { useMemo } from 'react';
import { createAvatar } from '@dicebear/core';
import * as avatarStyle from '@dicebear/avataaars';

interface AvatarProps {
  seed: string;
  size?: number;
  className?: string;
  url?: string | null;
}

export function Avatar({ seed, size = 32, className = '', url }: AvatarProps) {
  const svgUri = useMemo(() => {
    const avatar = createAvatar(avatarStyle, {
      seed,
      size,
      backgroundColor: ['transparent'],
    });
    return avatar.toDataUri();
  }, [seed, size]);

  if (url) {
    return (
      <img
        src={url}
        alt={seed}
        width={size}
        height={size}
        className={`rounded-full flex-shrink-0 object-cover ${className}`}
      />
    );
  }

  return (
    <img
      src={svgUri}
      alt={seed}
      width={size}
      height={size}
      className={`rounded-full flex-shrink-0 bg-transparent ${className}`}
    />
  );
}
