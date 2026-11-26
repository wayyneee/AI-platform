// 呼叫前的參數檢查：超出範圍、選項不在清單中、型別不對時回報錯誤；不在定義中的略過；沒填的用預設值。

import { describe, expect, it } from 'vitest';

import type { ParamDefinition } from '../../../shared/PlatformInfrastructure/types.ts';
import { validateParams } from './paramValidation.ts';

const DEFINITIONS: ParamDefinition[] = [
  { key: 'maxOutputTokens', kind: 'number', min: 1, max: 8000, isInteger: true, default: 1000 },
  { key: 'temperature', kind: 'number', min: 0, max: 2 },
  { key: 'reasoningEffort', kind: 'select', options: ['low', 'medium', 'high'] },
  { key: 'webSearch', kind: 'boolean', default: false },
  {
    key: 'loras',
    kind: 'weightedList',
    options: ['detailTweaker', 'flatColor'],
    weight: { min: -2, max: 2, default: 1 },
  },
];

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('參數檢查', () => {
  it('參數超出範圍時回報錯誤', () => {
    expect(codeOf(() => validateParams(DEFINITIONS, { temperature: 2.5 }, 'invokeModel'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
    expect(codeOf(() => validateParams(DEFINITIONS, { maxOutputTokens: 0 }, 'invokeModel'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
  });

  it('選項不在清單中時回報錯誤', () => {
    expect(
      codeOf(() => validateParams(DEFINITIONS, { reasoningEffort: 'max' }, 'invokeModel')),
    ).toBe('INVOCATION_PARAM_INVALID');
  });

  it('LoRA 不在清單中或權重超出範圍時回報錯誤', () => {
    const unknownLora = { loras: [{ name: 'unknown', weight: 1 }] };
    const tooHeavy = { loras: [{ name: 'flatColor', weight: 3 }] };
    expect(codeOf(() => validateParams(DEFINITIONS, unknownLora, 'submitTask'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
    expect(codeOf(() => validateParams(DEFINITIONS, tooHeavy, 'submitTask'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
  });

  it('型別不對時回報錯誤（整數參數給小數、是否參數給文字）', () => {
    expect(codeOf(() => validateParams(DEFINITIONS, { maxOutputTokens: 1.5 }, 'x'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
    expect(codeOf(() => validateParams(DEFINITIONS, { webSearch: 'yes' }, 'x'))).toBe(
      'INVOCATION_PARAM_INVALID',
    );
  });

  it('錯誤標明是哪個參數、哪個介面', () => {
    try {
      validateParams(DEFINITIONS, { temperature: -1 }, 'invokeModel');
    } catch (error) {
      expect(error).toMatchObject({
        interfaceName: 'invokeModel',
        details: { key: 'temperature', value: -1 },
      });
    }
  });

  it('不在定義中的參數略過；沒填的參數有預設值用預設值，沒有就不送', () => {
    const checked = validateParams(
      DEFINITIONS,
      { temperature: 0.7, topK: 40, loras: [{ name: 'flatColor', weight: 0.8 }] },
      'invokeModel',
    );
    expect(checked).toEqual({
      maxOutputTokens: 1000,
      temperature: 0.7,
      webSearch: false,
      loras: [{ name: 'flatColor', weight: 0.8 }],
    });
  });
});
