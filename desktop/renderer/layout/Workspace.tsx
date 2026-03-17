// ============================================================
// Xuanji Desktop - Workspace 组件
// ============================================================
// 职责：
// - 作为主工作区容器
// - 根据 currentView 渲染不同的视图组件
// - 支持视图切换动画
// ============================================================

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WorkspaceProps {
  view: string;
  children?: React.ReactNode;
}

// 视图切换动画配置
const viewTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.2 },
};

export default function Workspace({ view, children }: WorkspaceProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={viewTransition}
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
