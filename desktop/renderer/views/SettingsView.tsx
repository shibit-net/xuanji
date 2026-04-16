// ============================================================
// Xuanji Desktop - SettingsView 组件
// ============================================================
// 职责：
// - 系统设置视图的容器组件
// - 使用 configStore 管理配置数据
// - 提供用户设置界面
// ============================================================


import SettingsPanel from '../components/SettingsPanel';

interface SettingsViewProps {
  onClose: () => void;
}

export default function SettingsView({ onClose }: SettingsViewProps) {
  return <SettingsPanel onClose={onClose} />;
}
