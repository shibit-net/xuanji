// ============================================================
// TitleBar - 标题栏组件
// ============================================================

import { memo } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';
import appLogo from '../assets/logos/04e91e5e62d18be6f5969ca4fc7cfb99.png';

interface TitleBarProps {
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
}

function TitleBar({ onCompact: _onCompact, onShowStats: _onShowStats, onShowDiagnostics: _onShowDiagnostics }: TitleBarProps) {
  const language = useConfigStore((s) => s.settings.language);

  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  return (
    <div className="flex-shrink-0 h-10 bg-primary/5 backdrop-blur-xl flex items-center justify-between px-4 select-none drag">
      <div className="w-20"></div>

      <div className="flex items-center gap-2.5">
        <img src={appLogo} alt="Xuanji" className="w-5 h-5 rounded" />
        <div className="font-bold text-lg text-foreground">{getDesktopLabel('titlebar.app_name', language)}</div>
      </div>

      <div className="flex items-center gap-1 no-drag">
        <div className="w-px h-4 bg-border mx-1" />

        <Button variant="ghost" size="icon" onClick={handleMinimize} title={getDesktopLabel('titlebar.minimize', language)} className="h-7 w-7">
          <Minus size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleMaximize} title={getDesktopLabel('titlebar.maximize', language)} className="h-7 w-7">
          <Square size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleClose} title={getDesktopLabel('titlebar.close', language)} className="h-7 w-7 hover:bg-red-500/80 hover:text-white">
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}

export default memo(TitleBar);
