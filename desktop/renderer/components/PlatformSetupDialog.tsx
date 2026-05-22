/**
 * PlatformSetupDialog — 远端平台接入配置弹窗
 *
 * 设计文档：docs/platform-integration-design.md §9.3
 */

import { useState } from 'react';
import { X, QrCode, MessageCircle, MessageSquare, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatformStore } from '../stores/platformStore';

type PlatformType = 'wechat' | 'wecom' | 'feishu' | 'dingtalk';

const PLATFORM_INFO: Array<{
  type: PlatformType;
  name: string;
  icon: React.ReactNode;
  desc: string;
  configFields?: string[];
}> = [
  {
    type: 'wechat',
    name: '微信',
    icon: <MessageCircle size={20} />,
    desc: '扫码登录（推荐），无需配置，微信 8.0.70+ 扫码即可',
  },
  {
    type: 'wecom',
    name: '企业微信',
    icon: <MessageSquare size={20} />,
    desc: '需要配置 corp_id, agent_id, secret',
    configFields: ['corp_id', 'agent_id', 'secret', 'token', 'encoding_aes_key'],
  },
  {
    type: 'feishu',
    name: '飞书',
    icon: <Globe size={20} />,
    desc: '需要配置 app_id, app_secret',
    configFields: ['app_id', 'app_secret'],
  },
  {
    type: 'dingtalk',
    name: '钉钉',
    icon: <MessageCircle size={20} />,
    desc: '需要配置 client_id, client_secret',
    configFields: ['client_id', 'client_secret'],
  },
];

export default function PlatformSetupDialog() {
  const [selected, setSelected] = useState<PlatformType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState(false);
  const { setSetupDialogOpen, addSession } = usePlatformStore();

  const handleSelect = (type: PlatformType) => {
    setSelected(type);
    setFormData({});
  };

  const handleBack = () => {
    setSelected(null);
    setFormData({});
  };

  const handleConnect = async () => {
    const info = PLATFORM_INFO.find((p) => p.type === selected);
    if (!info) return;

    setConnecting(true);
    try {
      // TODO: 调用 Electron IPC 启用平台 adapter
      // await window.electron.platformEnable(selected!, formData);
      // 临时模拟成功
      addSession({
        id: `${selected}-${Date.now()}`,
        platform: selected!,
        name: formData.name || info.name,
        status: 'connecting',
        unreadCount: 0,
        sessionKey: `${selected}:private:${formData.name || 'unknown'}`,
        userId: formData.name || 'unknown',
        chatId: formData.name || 'unknown',
      });
      setSetupDialogOpen(false);
    } catch (err) {
      console.error('Failed to connect platform:', err);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-[480px] max-h-[600px] overflow-y-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">
            {selected
              ? `${PLATFORM_INFO.find((p) => p.type === selected)?.name} 配置`
              : '选择接入方式'}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setSetupDialogOpen(false)}>
            <X size={16} />
          </Button>
        </div>

        {/* 内容 */}
        <div className="p-4">
          {!selected ? (
            // 平台选择列表
            <div className="space-y-2">
              {PLATFORM_INFO.map((info) => (
                <Button
                  key={info.type}
                  variant="outline"
                  className="w-full justify-start gap-3 p-4 h-auto"
                  onClick={() => handleSelect(info.type)}
                >
                  <div className="text-primary">{info.icon}</div>
                  <div className="text-left">
                    <div className="font-medium">{info.name}</div>
                    <div className="text-xs text-muted-foreground">{info.desc}</div>
                  </div>
                  {info.type === 'wechat' && (
                    <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                      推荐
                    </span>
                  )}
                </Button>
              ))}
            </div>
          ) : (
            // 配置表单
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
                ← 返回选择
              </Button>

              {selected === 'wechat' ? (
                // 微信扫码
                <div className="text-center py-8">
                  <div className="w-48 h-48 mx-auto mb-4 bg-muted rounded-lg flex items-center justify-center">
                    <QrCode size={64} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    请使用微信 8.0.70+ 扫描二维码
                  </p>
                  <Button onClick={handleConnect} disabled={connecting}>
                    {connecting ? '等待扫码...' : '模拟连接'}
                  </Button>
                </div>
              ) : (
                // 配置表单
                <>
                  {PLATFORM_INFO.find((p) => p.type === selected)?.configFields?.map((field) => (
                    <div key={field}>
                      <label className="block text-sm font-medium mb-1">{field}</label>
                      <input
                        type={field.includes('secret') || field.includes('key') ? 'password' : 'text'}
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                        placeholder={`输入 ${field}`}
                        value={formData[field] || ''}
                        onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
                      />
                    </div>
                  ))}
                  <Button onClick={handleConnect} disabled={connecting} className="w-full">
                    {connecting ? '连接中...' : '连接'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-border">
          <Button variant="outline" className="w-full" onClick={() => setSetupDialogOpen(false)}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
