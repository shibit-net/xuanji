import { describe, it, expect, afterEach } from 'vitest';
import { PersistentShell } from '@/core/tools/PersistentShell';

describe('PersistentShell', () => {
  let shell: PersistentShell;

  afterEach(() => {
    shell?.close();
  });

  it('应执行简单命令并返回输出', async () => {
    shell = new PersistentShell();
    const result = await shell.execute('echo hello', 5000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
  });

  it('cwd 应跨调用保持', async () => {
    shell = new PersistentShell('/tmp');
    await shell.execute('cd /usr', 5000);
    const result = await shell.execute('pwd', 5000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('/usr');
  });

  it('环境变量应跨调用保持', async () => {
    shell = new PersistentShell();
    await shell.execute('export XUANJI_TEST_VAR=hello_world', 5000);
    const result = await shell.execute('echo $XUANJI_TEST_VAR', 5000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello_world');
  });

  it('应正确返回退出码', async () => {
    shell = new PersistentShell();
    const result = await shell.execute('exit 42', 5000);
    // exit 42 会退出 shell 进程，所以我们用 false 命令代替
    const result2 = await shell.execute('false', 5000);
    expect(result2.exitCode).toBe(1);
  });

  it('应捕获 stderr', async () => {
    shell = new PersistentShell();
    const result = await shell.execute('echo err >&2', 5000);
    expect(result.stderr).toContain('err');
  });

  it('应在超时后拒绝', async () => {
    shell = new PersistentShell();
    await expect(
      shell.execute('sleep 10', 200),
    ).rejects.toThrow('超时');
  });

  it('reset 应重建 shell', async () => {
    shell = new PersistentShell();
    await shell.execute('export RESET_TEST=abc', 5000);
    shell.reset();
    const result = await shell.execute('echo $RESET_TEST', 5000);
    // 重置后环境变量不再存在
    expect(result.stdout.trim()).toBe('');
  });

  it('close 后 ready 应为 false', () => {
    shell = new PersistentShell();
    expect(shell.ready).toBe(false); // 未执行命令时尚未 spawn
    shell.close();
    expect(shell.ready).toBe(false);
  });
});
