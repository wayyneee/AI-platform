// SystemLog 的 log 存放：查詢、篩選、換檔、重新啟動後讀回、寫檔失敗。

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogStore } from './logStore.ts';

let logDirectory: string;

beforeEach(() => {
  logDirectory = mkdtempSync(path.join(tmpdir(), 'system-log-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(logDirectory, { recursive: true, force: true });
});

describe('SystemLog', () => {
  it('寫入的 log 查得到，新的在前，可以依等級篩選', () => {
    const store = new LogStore();
    store.write({ level: 'success', module: 'Test', action: '第一件事' });
    store.write({ level: 'error', module: 'Test', action: '第二件事' });
    store.write({ level: 'success', module: 'Test', action: '第三件事' });

    expect(store.list().map((entry) => entry.action)).toEqual(['第三件事', '第二件事', '第一件事']);
    expect(store.list({ level: 'success' }).map((entry) => entry.action)).toEqual([
      '第三件事',
      '第一件事',
    ]);
    expect(store.list({ level: 'warning' })).toEqual([]);
  });

  it('紀錄檔超過 10MB 時換新檔，最多只留 2 個檔', () => {
    // 用 2KB 當上限代替 10MB，行為相同，測試不用真的寫 10MB
    const maxFileBytes = 2000;
    const store = new LogStore({ maxFileBytes });
    store.openFiles(logDirectory);
    for (let index = 0; index < 100; index++) {
      store.write({ level: 'success', module: 'Test', action: `第 ${index} 件事` });
    }

    expect(readdirSync(logDirectory).sort()).toEqual(['system.1.log', 'system.log']);
    for (const fileName of readdirSync(logDirectory)) {
      expect(statSync(path.join(logDirectory, fileName)).size).toBeLessThanOrEqual(maxFileBytes);
    }
  });

  it('平台重新啟動後，能從紀錄檔讀回最近的 log；損壞的行會被略過', () => {
    const before = new LogStore();
    before.openFiles(logDirectory);
    before.write({ level: 'success', module: 'Test', action: '重新啟動前' });
    // 模擬寫到一半斷電的行和亂碼
    writeFileSync(path.join(logDirectory, 'system.log'), '{"id":"broken", "lev\nnot json\n', {
      flag: 'a',
    });

    const after = new LogStore();
    after.openFiles(logDirectory);

    expect(after.list().map((entry) => entry.action)).toEqual(['重新啟動前']);
  });

  it('寫檔失敗時，寫 log 的功能不會失敗，畫面上的 log 仍查得到', () => {
    const terminalOutput = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const store = new LogStore();
    store.openFiles(logDirectory);
    // 紀錄檔的位置被資料夾佔住，寫檔一定失敗
    mkdirSync(path.join(logDirectory, 'system.log'));

    expect(() =>
      store.write({ level: 'warning', module: 'Test', action: '寫檔會失敗' }),
    ).not.toThrow();
    expect(store.list().map((entry) => entry.action)).toEqual(['寫檔會失敗']);
    expect(terminalOutput).toHaveBeenCalledWith(expect.stringContaining('寫入紀錄檔失敗'));
  });
});
