// 花費計算：花費 = 用量 × 價格；沒填價格只統計用量；網頁搜尋另外算，OpenRouter 用它回報的搜尋金額。

import { describe, expect, it } from 'vitest';

import type { LlmUsage, MediaUsage } from '../../../shared/PlatformInfrastructure/types.ts';
import { calculateUsage } from './usageCost.ts';

const LLM_USAGE: LlmUsage = { inputTokens: 2_000_000, outputTokens: 500_000, searchCount: 0 };
const NO_MEDIA: MediaUsage = { imageCount: 0, videoSeconds: 0, characterCount: 0 };

describe('花費計算正確；沒填價格只統計用量', () => {
  it('LLM 的花費為輸入、輸出 token 各自乘上每 100 萬 token 的價格', () => {
    const result = calculateUsage(
      { type: 'llm', price: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 } },
      LLM_USAGE,
    );
    expect(result.costUsd).toBeCloseTo(2 * 3 + 0.5 * 15);
    expect(result).toMatchObject({
      inputTokens: 2_000_000,
      outputTokens: 500_000,
      hasPricedUsage: true,
      hasUnpricedUsage: false,
    });
  });

  it('沒填價格的 LLM 只統計 token，花費為 0 並標示有未計價的用量', () => {
    const result = calculateUsage({ type: 'llm', price: {} }, LLM_USAGE);
    expect(result).toMatchObject({
      costUsd: 0,
      inputTokens: 2_000_000,
      outputTokens: 500_000,
      hasPricedUsage: false,
      hasUnpricedUsage: true,
    });
  });

  it('圖片以張、影片以秒、語音以每 100 萬字計價', () => {
    const image = calculateUsage(
      { type: 'image', price: { perUnit: 0.07 } },
      { ...NO_MEDIA, imageCount: 3 },
    );
    const video = calculateUsage(
      { type: 'video', price: { perUnit: 0.05 } },
      { ...NO_MEDIA, videoSeconds: 8 },
    );
    const voice = calculateUsage(
      { type: 'audio', price: { perUnit: 15 } },
      { ...NO_MEDIA, characterCount: 2000 },
    );
    expect(image).toMatchObject({ imageCount: 3, hasPricedUsage: true });
    expect(image.costUsd).toBeCloseTo(0.21);
    expect(video).toMatchObject({ videoSeconds: 8 });
    expect(video.costUsd).toBeCloseTo(0.4);
    expect(voice).toMatchObject({ characterCount: 2000 });
    expect(voice.costUsd).toBeCloseTo(0.03);
  });

  it('沒填價格的語音只統計字數', () => {
    const result = calculateUsage(
      { type: 'audio', price: {} },
      { ...NO_MEDIA, characterCount: 1800 },
    );
    expect(result).toMatchObject({
      costUsd: 0,
      characterCount: 1800,
      hasPricedUsage: false,
      hasUnpricedUsage: true,
    });
  });

  it('只記下這個類型的計費單位，其他類型的數字不算進來', () => {
    const result = calculateUsage(
      { type: 'image', price: { perUnit: 0.07 } },
      { imageCount: 2, videoSeconds: 5, characterCount: 10 },
    );
    expect(result).toMatchObject({ imageCount: 2, videoSeconds: 0, characterCount: 0 });
  });

  it('用量是 0 時不算有價格，也不算未計價', () => {
    const result = calculateUsage(
      { type: 'llm', price: {} },
      {
        inputTokens: 0,
        outputTokens: 0,
        searchCount: 0,
      },
    );
    expect(result).toMatchObject({ costUsd: 0, hasPricedUsage: false, hasUnpricedUsage: false });
  });
});

describe('搜尋花費為搜尋次數 × 每次搜尋價格；沒填每次搜尋價格時只統計次數；OpenRouter 用它回報的搜尋金額', () => {
  const tokenPrice = { inputPerMillionTokens: 1, outputPerMillionTokens: 2 };
  const usage: LlmUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, searchCount: 6 };

  it('搜尋花費為搜尋次數 × 每次搜尋價格，加在 token 花費上', () => {
    const result = calculateUsage(
      { type: 'llm', price: { ...tokenPrice, perSearch: 0.01 } },
      usage,
    );
    expect(result.searchCount).toBe(6);
    expect(result.costUsd).toBeCloseTo(1 + 2 + 0.06);
    expect(result.hasUnpricedUsage).toBe(false);
  });

  it('沒填每次搜尋價格時只統計搜尋次數，花費只算 token，並標示有未計價的用量', () => {
    const result = calculateUsage({ type: 'llm', price: tokenPrice }, usage);
    expect(result.searchCount).toBe(6);
    expect(result.costUsd).toBeCloseTo(3);
    expect(result).toMatchObject({ hasPricedUsage: true, hasUnpricedUsage: true });
  });

  it('供應商回報搜尋金額時（OpenRouter）直接用它', () => {
    const result = calculateUsage(
      { type: 'llm', price: tokenPrice },
      { ...usage, reportedSearchCostUsd: 0.024 },
    );
    expect(result.costUsd).toBeCloseTo(3.024);
    expect(result.hasUnpricedUsage).toBe(false);
  });
});
