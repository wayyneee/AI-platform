// 各家的模型偵測：七項能力依供應商回傳的資料標成支援、不支援或未知。回應範例依各家官方文件的模型清單形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeConnector } from './claude.ts';
import { geminiConnector } from './gemini.ts';
import { grokConnector } from './grok.ts';
import { openRouterConnector } from './openRouter.ts';
import {
  ALL_UNKNOWN,
  OPENROUTER_CLAUDE,
  OPENROUTER_QWEN,
  CLAUDE_OPUS,
  CLAUDE_HAIKU_OLD,
  GEMINI_FLASH,
  GEMINI_OLD,
} from './modelFixtures.ts';
import { jsonReply, mockFetch, TEST_API_KEY } from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('七項能力依供應商回傳的資料標成支援、不支援或未知；供應商沒提供的一律標未知', () => {
  it('Grok：圖片依輸入類型；有思考程度選項才算會思考；有搜尋價格才算能搜尋；其他標未知', async () => {
    mockFetch(
      jsonReply({
        models: [
          {
            id: 'grok-4.3',
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            search_price: 250000000,
            capabilities: { reasoning_effort: ['low', 'high'] },
          },
          {
            id: 'grok-3-fast',
            input_modalities: ['text'],
            output_modalities: ['text'],
            capabilities: { reasoning_effort: [] },
          },
        ],
      }),
      jsonReply({ data: [{ id: 'grok-4.3', context_length: 1000000 }] }),
    );
    const [withData, withoutData] = await grokConnector.listChatModels(TEST_API_KEY);
    expect(withData.capabilities).toEqual({
      imageInput: 'yes',
      fileInput: 'unknown',
      webSearch: 'yes',
      thinking: 'yes',
      tools: 'unknown',
      contextWindow: 1000000,
      maxOutputTokens: null,
    });
    expect(withoutData.capabilities).toEqual({
      ...ALL_UNKNOWN,
      imageInput: 'no',
    });
  });

  it('OpenRouter：圖片、檔案依輸入類型；思考、工具依支援的參數；網頁搜尋所有模型都能用', async () => {
    mockFetch(jsonReply({ data: [OPENROUTER_CLAUDE, OPENROUTER_QWEN] }));
    const [claude, qwen] = await openRouterConnector.listChatModels(TEST_API_KEY);
    expect(claude.capabilities).toEqual({
      imageInput: 'yes',
      fileInput: 'yes',
      webSearch: 'yes',
      thinking: 'yes',
      tools: 'yes',
      contextWindow: 1000000,
      maxOutputTokens: 128000,
    });
    expect(qwen.capabilities).toEqual({
      imageInput: 'no',
      fileInput: 'no',
      webSearch: 'yes',
      thinking: 'no',
      tools: 'no',
      contextWindow: 131072,
      maxOutputTokens: null,
    });
  });

  it('Claude：能力取自 Models API；沒有工具能力欄位標未知；capabilities 缺少時一律未知', async () => {
    mockFetch(
      jsonReply({ data: [CLAUDE_OPUS, CLAUDE_HAIKU_OLD], has_more: false }),
      jsonReply({
        data: [{ id: 'claude-x', display_name: 'X', capabilities: null }],
        has_more: false,
      }),
    );
    const [opus, haiku] = await claudeConnector.listChatModels(TEST_API_KEY);
    expect(opus.capabilities).toEqual({
      imageInput: 'yes',
      fileInput: 'yes',
      webSearch: 'yes',
      thinking: 'yes',
      tools: 'unknown',
      contextWindow: 1000000,
      maxOutputTokens: 128000,
    });
    expect(haiku.capabilities?.webSearch).toBe('no');

    const [unknown] = await claudeConnector.listChatModels(TEST_API_KEY);
    expect(unknown.capabilities).toEqual(ALL_UNKNOWN);
  });

  it('Gemini：上限與思考取自 models.list，其他標未知', async () => {
    mockFetch(jsonReply({ models: [GEMINI_FLASH, GEMINI_OLD] }));
    const [flash, old] = await geminiConnector.listChatModels(TEST_API_KEY);
    expect(flash.capabilities).toEqual({
      ...ALL_UNKNOWN,
      thinking: 'yes',
      contextWindow: 1048576,
      maxOutputTokens: 65536,
    });
    expect(old.capabilities?.thinking).toBe('no');
  });
});
