// 平台啟動與資料路徑：建立 data/、重複啟動、自動測試不碰正式資料。

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listLogs } from '../SystemLog/index.ts';
import { resolveDataDirectory } from './dataDirectory.ts';
import { initializePlatform } from './platformStartup.ts';

let temporaryRoot: string;

beforeEach(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), 'platform-startup-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('PlatformBootstrap 啟動', () => {
  it('啟動時建立 data/，重複啟動不出錯', () => {
    const dataDirectory = path.join(temporaryRoot, 'data');
    vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);

    initializePlatform();
    expect(() => initializePlatform()).not.toThrow();

    expect(existsSync(dataDirectory)).toBe(true);
    expect(existsSync(path.join(dataDirectory, 'PlatformInfrastructure', 'system.log'))).toBe(true);
    expect(listLogs()[0]).toMatchObject({ level: 'success', action: '平台初始化完成' });
  });

  it('自動測試不碰正式的 data/', () => {
    vi.stubEnv('PLATFORM_DATA_DIR', '');
    expect(() => resolveDataDirectory()).toThrow(/PLATFORM_DATA_DIR/);

    vi.stubEnv('PLATFORM_DATA_DIR', temporaryRoot);
    expect(resolveDataDirectory()).toBe(path.resolve(temporaryRoot));
  });
});
