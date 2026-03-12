// ============================================================
// 系统通知推送器 (macOS/Windows/Linux)
// ============================================================

import { logger } from '@/core/logger';
import type { IPusher, PushNotification } from './types';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const log = logger.child({ module: 'system-pusher' });

/**
 * SystemPusher — 使用系统原生通知
 *
 * - macOS: osascript (AppleScript)
 * - Linux: notify-send
 * - Windows: 通过 PowerShell
 */
export class SystemPusher implements IPusher {
  private platform: NodeJS.Platform;
  private available = false;

  constructor() {
    this.platform = process.platform;
  }

  async init(): Promise<void> {
    // 检查系统是否支持通知
    try {
      switch (this.platform) {
        case 'darwin':
          // macOS 总是支持
          this.available = true;
          break;
        case 'linux':
          // 检查是否安装了 notify-send
          await execAsync('which notify-send');
          this.available = true;
          break;
        case 'win32':
          // Windows 通过 PowerShell 支持
          this.available = true;
          break;
        default:
          this.available = false;
      }
      log.info(`System pusher initialized: ${this.available ? 'available' : 'unavailable'}`);
    } catch (error) {
      log.warn('System pusher not available:', error);
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async push(notification: PushNotification): Promise<void> {
    if (!this.available) {
      log.warn('System notifications not available');
      return;
    }

    try {
      switch (this.platform) {
        case 'darwin':
          await this.pushMacOS(notification);
          break;
        case 'linux':
          await this.pushLinux(notification);
          break;
        case 'win32':
          await this.pushWindows(notification);
          break;
      }
      log.info(`System notification sent: ${notification.title}`);
    } catch (error) {
      log.error('Failed to send system notification:', error);
    }
  }

  /** macOS 通知 (AppleScript) */
  private async pushMacOS(notification: PushNotification): Promise<void> {
    const title = this.escapeAppleScript(notification.title);
    const body = this.escapeAppleScript(notification.body);
    const script = `display notification "${body}" with title "${title}" sound name "Ping"`;
    await execAsync(`osascript -e '${script}'`);
  }

  /** Linux 通知 (notify-send) */
  private async pushLinux(notification: PushNotification): Promise<void> {
    const urgency = notification.priority === 'urgent' ? 'critical' : 'normal';
    const title = this.escapeShell(notification.title);
    const body = this.escapeShell(notification.body);
    await execAsync(`notify-send -u ${urgency} "${title}" "${body}"`);
  }

  /** Windows 通知 (PowerShell) */
  private async pushWindows(notification: PushNotification): Promise<void> {
    const title = this.escapePowerShell(notification.title);
    const body = this.escapePowerShell(notification.body);
    const script = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $template = @"
<toast>
  <visual>
    <binding template="ToastText02">
      <text id="1">${title}</text>
      <text id="2">${body}</text>
    </binding>
  </visual>
</toast>
"@
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Xuanji")
      $notifier.Show($toast)
    `.trim();
    await execAsync(`powershell -Command "${script}"`);
  }

  /** 转义 AppleScript 字符串 */
  private escapeAppleScript(str: string): string {
    return str.replace(/["\\]/g, '\\$&');
  }

  /** 转义 Shell 字符串 */
  private escapeShell(str: string): string {
    return str.replace(/["$`\\]/g, '\\$&');
  }

  /** 转义 PowerShell 字符串 */
  private escapePowerShell(str: string): string {
    return str.replace(/["$`]/g, '`$&');
  }
}
