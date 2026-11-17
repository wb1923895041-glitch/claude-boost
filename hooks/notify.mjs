// 系统通知：Windows 弹 Toast，macOS 用 osascript，Linux 用 notify-send。后台发出，不阻塞 Agent。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './lib.mjs';

const DEFAULTS = { notify: true, notifyMinSeconds: 60, autoRetry: true, autoRetryWaitSeconds: 8 };

/** 用户配置：~/.gemini/claude-boost/config.json */
export function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')) };
  } catch { return { ...DEFAULTS }; }
}

const PS_TOAST = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode($env:CB_TITLE)) > $null
$x.Item(1).AppendChild($t.CreateTextNode($env:CB_BODY)) > $null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))
`;

export function notify(title, body) {
  // 测试用：把通知写进文件而不是真的弹出来
  if (process.env.CLAUDE_BOOST_NOTIFY_FILE) {
    fs.appendFileSync(process.env.CLAUDE_BOOST_NOTIFY_FILE, JSON.stringify({ title, body }) + '\n');
    return;
  }
  const env = { ...process.env, CB_TITLE: title, CB_BODY: body };
  let cmd, args;
  if (process.platform === 'win32') {
    const encoded = Buffer.from(PS_TOAST, 'utf16le').toString('base64');
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded];
  } else if (process.platform === 'darwin') {
    cmd = 'osascript';
    args = ['-e', 'display notification (system attribute "CB_BODY") with title (system attribute "CB_TITLE")'];
  } else {
    cmd = 'notify-send';
    args = [title, body];
  }
  try {
    const child = spawn(cmd, args, { env, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}
