// API key：新增、列出、修改、刪除；遮罩值；同供應商同名；只改名稱時 key 不變。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { isPlatformError } from '../SystemLog/index.ts';
import {
  addApiKey,
  deleteApiKey,
  getApiKeyValue,
  listApiKeys,
  maskApiKey,
  updateApiKey,
} from './apiKeyStore.ts';

const OPENROUTER_KEY = 'sk-or-v1-0123456789abcdef';
const OPENAI_KEY = 'sk-proj-ABCDEFGHIJKLMN9Qx2';

let dataDirectory: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-api-keys-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
});

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

/** 執行並回傳丟出的錯誤代碼；沒丟出錯誤時讓測試失敗。 */
function catchErrorCode(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    if (isPlatformError(error)) return error.code;
    throw error;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

describe('ModelRegistry API key', () => {
  it('新增、列出、修改、刪除 API key；列出時只有遮罩值；只改名稱時 key 不變', () => {
    const added = addApiKey({ provider: 'openrouter', name: '個人', keyValue: OPENROUTER_KEY });
    expect(added).toEqual({
      id: added.id,
      provider: 'openrouter',
      name: '個人',
      maskedKey: 'sk-****cdef',
    });
    expect(listApiKeys()).toEqual([added]);
    expect(JSON.stringify(listApiKeys())).not.toContain(OPENROUTER_KEY);

    const renamed = updateApiKey({ id: added.id, name: '主要' });
    expect(renamed.name).toBe('主要');
    expect(getApiKeyValue(added.id)).toBe(OPENROUTER_KEY);

    // 修改 key 時留空代表不變
    updateApiKey({ id: added.id, name: '主要', keyValue: '' });
    expect(getApiKeyValue(added.id)).toBe(OPENROUTER_KEY);

    const rekeyed = updateApiKey({ id: added.id, name: '主要', keyValue: OPENAI_KEY });
    expect(rekeyed.maskedKey).toBe('sk-****9Qx2');
    expect(getApiKeyValue(added.id)).toBe(OPENAI_KEY);

    deleteApiKey(added.id);
    expect(listApiKeys()).toEqual([]);
  });

  it('列出時依新增的先後排列', () => {
    addApiKey({ provider: 'openrouter', name: 'A', keyValue: OPENROUTER_KEY });
    addApiKey({ provider: 'openai', name: 'B', keyValue: OPENAI_KEY });
    addApiKey({ provider: 'claude', name: 'C', keyValue: OPENAI_KEY });
    expect(listApiKeys().map((key) => key.name)).toEqual(['A', 'B', 'C']);
  });

  it('遮罩值：長度 12 以上顯示前 3 碼 + **** + 後 4 碼，未滿 12 只顯示 ****', () => {
    expect(maskApiKey('abcdefghijkl')).toBe('abc****ijkl');
    expect(maskApiKey('abcdefghijk')).toBe('****');
    expect(maskApiKey('')).toBe('****');
  });

  it('同供應商同名的 key 無法新增；不同供應商可以同名', () => {
    addApiKey({ provider: 'openrouter', name: '個人', keyValue: OPENROUTER_KEY });

    expect(
      catchErrorCode(() =>
        addApiKey({ provider: 'openrouter', name: ' 個人 ', keyValue: OPENAI_KEY }),
      ),
    ).toBe('API_KEY_NAME_TAKEN');
    expect(addApiKey({ provider: 'openai', name: '個人', keyValue: OPENAI_KEY }).name).toBe('個人');
    expect(listApiKeys()).toHaveLength(2);
  });

  it('改名成同供應商其他 key 的名稱時回報錯誤，資料不被修改；改成自己原本的名稱可以', () => {
    const first = addApiKey({ provider: 'grok', name: '個人', keyValue: OPENROUTER_KEY });
    addApiKey({ provider: 'grok', name: '工作用', keyValue: OPENAI_KEY });

    expect(catchErrorCode(() => updateApiKey({ id: first.id, name: '工作用' }))).toBe(
      'API_KEY_NAME_TAKEN',
    );
    expect(listApiKeys()[0].name).toBe('個人');
    expect(updateApiKey({ id: first.id, name: '個人' }).name).toBe('個人');
  });

  it('名稱、key 空白或供應商不需要 key 時無法新增', () => {
    expect(
      catchErrorCode(() => addApiKey({ provider: 'grok', name: '  ', keyValue: OPENAI_KEY })),
    ).toBe('API_KEY_NAME_REQUIRED');
    expect(catchErrorCode(() => addApiKey({ provider: 'grok', name: '個人', keyValue: ' ' }))).toBe(
      'API_KEY_VALUE_REQUIRED',
    );
    expect(
      catchErrorCode(() => addApiKey({ provider: 'forge', name: '本機', keyValue: OPENAI_KEY })),
    ).toBe('API_KEY_PROVIDER_INVALID');
    expect(listApiKeys()).toEqual([]);
  });

  it('名稱和 key 前後的空白會去掉', () => {
    const added = addApiKey({ provider: 'grok', name: ' 個人 ', keyValue: ` ${OPENAI_KEY}\n` });
    expect(added.name).toBe('個人');
    expect(getApiKeyValue(added.id)).toBe(OPENAI_KEY);
  });

  it('修改或刪除不存在的 key 時回報找不到', () => {
    expect(catchErrorCode(() => updateApiKey({ id: 'missing', name: '個人' }))).toBe(
      'API_KEY_NOT_FOUND',
    );
    expect(catchErrorCode(() => deleteApiKey('missing'))).toBe('API_KEY_NOT_FOUND');
  });
});
