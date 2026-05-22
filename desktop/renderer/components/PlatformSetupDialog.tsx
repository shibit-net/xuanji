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
  const [qrCodeImg, setQrCodeImg] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string>('');
  const { setSetupDialogOpen, addSession } = usePlatformStore();

  const handleSelect = (type: PlatformType) => {
    setSelected(type);
    setFormData({});
    setScanStatus('');

    if (type === 'wechat') {
      loadWechatQR();
    }
  };

  const loadWechatQR = async () => {
    setQrCodeImg(null);
    setQrCodeUrl(null);
    setScanStatus('正在获取二维码...');
    try {
      const result = await window.electron.platformWechatQR();
      if (result.success && result.qrcodeUrl) {
        setQrCodeUrl(result.qrcodeUrl);
        setQrCodeImg(result.qrcodeImgBase64 || null);
        setScanStatus('请使用微信扫码');
        // 自动开始轮询
        startWechatScan(result.qrcodeUrl);
      } else {
        setScanStatus(`获取二维码失败: ${result.error || '未知错误'}`);
      }
    } catch (err) {
      setScanStatus(`获取二维码失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const startWechatScan = async (qrcode: string) => {
    setConnecting(true);
    try {
      setScanStatus('等待扫码...');
      const result = await window.electron.platformWechatScan({ qrcodeUrl: qrcode });
      if (result.success) {
        if (result.sessions) {
          for (const s of result.sessions) {
            addSession(s);
          }
        }
        setSetupDialogOpen(false);
      } else {
        setScanStatus(`扫码失败: ${result.error || '未知错误'}`);
        // 允许重新获取二维码
        setConnecting(false);
      }
    } catch (err) {
      setScanStatus(`扫码失败: ${err instanceof Error ? err.message : String(err)}`);
      setConnecting(false);
    }
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
      const result = await window.electron.platformEnable({
        platform: selected!,
        config: formData,
      });

      if (result.success) {
        if (result.sessions) {
          for (const s of result.sessions) {
            addSession(s);
          }
        }
        setSetupDialogOpen(false);
      } else {
        alert(`连接失败: ${result.error || '未知错误'}`);
      }
    } catch (err) {
      alert(`连接失败: ${err instanceof Error ? err.message : String(err)}`);
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
                <div className="text-center py-6">
                  <div className="w-48 h-48 mx-auto mb-4 bg-white rounded-lg flex items-center justify-center border-2 border-border">
                    {qrCodeUrl ? (
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${qrCodeUrl}&bot_type=3`)}`}
                        alt="微信二维码"
                        className="w-44 h-44 object-contain"
                      />
                    ) : (
                      <QrCode size={64} className="text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    请使用微信扫码登录
                  </p>
                  <p className={`text-xs mb-4 ${connecting ? 'text-blue-500 animate-pulse' : scanStatus.includes('失败') ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {scanStatus || '准备获取二维码'}
                  </p>
                  {!connecting && scanStatus.includes('失败') && (
                    <Button onClick={loadWechatQR} size="sm" variant="outline">
                      重新获取二维码
                    </Button>
                  )}
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
