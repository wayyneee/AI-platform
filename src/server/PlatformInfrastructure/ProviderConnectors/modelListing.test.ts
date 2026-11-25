// 各家的模型偵測：模型清單、自動帶入的價格、可調參數。回應範例依各家官方文件的模型清單形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeConnector } from './claude.ts';
import { geminiConnector } from './gemini.ts';
import { grokConnector } from './grok.ts';
import { openAiConnector } from './openAi.ts';
import { openRouterConnector } from './openRouter.ts';
import {
  ALL_UNKNOWN,
  OPENROUTER_CLAUDE,
  OPENROUTER_QWEN,
  OPENROUTER_AUTO,
  CLAUDE_OPUS,
  CLAUDE_HAIKU_OLD,
  CLAUDE_RETIRED,
  GEMINI_FLASH,
  GEMINI_OLD,
  GEMINI_EMBEDDING,
  GEMINI_IMAGE,
} from './modelFixtures.ts';
import { jsonReply, mockFetch, TEST_API_KEY } from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('各供應商的模型清單、自動帶入的價格、可調參數正確產生', () => {
  it('OpenAI：只列出對話模型，能力全部標未知，不帶價格，可調參數只有網頁搜尋', async () => {
    const requests = mockFetch(
      jsonReply({
        object: 'list',
        data: [
          { id: 'gpt-5.6', object: 'model', created: 1686935002, owned_by: 'openai' },
          { id: 'text-embedding-3-small', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'gpt-4o-mini-tts', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'o4-mini', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'dall-e-3', object: 'model', created: 1, owned_by: 'openai' },
        ],
      }),
    );
    const models = await openAiConnector.listChatModels(TEST_API_KEY);

    expect(requests[0].url).toBe('https://api.openai.com/v1/models');
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6', 'o4-mini']);
    expect(models[0]).toEqual({
      id: 'gpt-5.6',
      displayName: 'gpt-5.6',
      type: 'llm',
      capabilities: ALL_UNKNOWN,
      params: [{ key: 'webSearch', kind: 'boolean', default: false }],
    });
  });

  it('Grok：只列出輸出文字的模型，價格換算成每 100 萬 token 美元，context window 取自 /v1/models', async () => {
    const requests = mockFetch(
      jsonReply({
        models: [
          {
            id: 'grok-4.3',
            aliases: ['grok-4.3-latest'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
            prompt_text_token_price: 12500,
            completion_text_token_price: 25000,
            search_price: 250000000,
            capabilities: {
              reasoning_effort: ['low', 'medium', 'high'],
              default_reasoning_effort: 'high',
            },
          },
          {
            id: 'grok-3-fast',
            input_modalities: ['text'],
            output_modalities: ['text'],
            prompt_text_token_price: 50000,
            completion_text_token_price: 250000,
            capabilities: { reasoning_effort: [] },
          },
          { id: 'grok-imagine-image', input_modalities: ['text'], output_modalities: ['image'] },
        ],
      }),
      jsonReply({
        object: 'list',
        data: [
          { id: 'grok-4.3', context_length: 1000000 },
          { id: 'grok-3-fast', context_length: 131072 },
        ],
      }),
    );
    const models = await grokConnector.listChatModels(TEST_API_KEY);

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.x.ai/v1/language-models',
      'https://api.x.ai/v1/models',
    ]);
    expect(models.map((model) => model.id)).toEqual(['grok-4.3', 'grok-3-fast']);
    expect(models[0].price).toEqual({
      inputPerMillionTokens: 1.25,
      outputPerMillionTokens: 2.5,
      perSearch: 0.025,
    });
    expect(models[0].params).toEqual([
      { key: 'maxOutputTokens', kind: 'number', min: 1, max: undefined, isInteger: true },
      { key: 'temperature', kind: 'number', min: 0, max: 2 },
      { key: 'reasoningEffort', kind: 'select', options: ['low', 'medium', 'high'] },
      { key: 'webSearch', kind: 'boolean', default: false },
    ]);
    expect(models[1].price).toEqual({ inputPerMillionTokens: 5, outputPerMillionTokens: 25 });
    expect(models[1].params.map((param) => param.key)).toEqual([
      'maxOutputTokens',
      'temperature',
      'webSearch',
    ]);
  });

  it('OpenRouter：價格換算成每 100 萬 token 美元，參數列出它回報的可調參數；動態價格不帶入', async () => {
    const requests = mockFetch(
      jsonReply({ data: [OPENROUTER_CLAUDE, OPENROUTER_QWEN, OPENROUTER_AUTO] }),
    );
    const [claude, qwen, auto] = await openRouterConnector.listChatModels(TEST_API_KEY);

    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/models?output_modalities=text');
    expect(claude).toMatchObject({
      id: 'anthropic/claude-sonnet-5.5',
      displayName: 'Anthropic: Claude Sonnet 5.5',
      description: 'Claude Sonnet 5.5 via OpenRouter',
      price: { inputPerMillionTokens: 2, outputPerMillionTokens: 10 },
    });
    // spec：OpenRouter 直接用它回報的搜尋金額，不帶每次搜尋價格
    expect(claude.price).not.toHaveProperty('perSearch');
    expect(claude.params).toEqual([
      { key: 'maxOutputTokens', kind: 'number', min: 1, max: 128000, isInteger: true },
      { key: 'temperature', kind: 'number', min: 0, max: 2 },
      { key: 'reasoningEffort', kind: 'select', options: ['high', 'medium', 'low'] },
      { key: 'webSearch', kind: 'boolean', default: false },
      { key: 'topP', kind: 'number', min: 0, max: 1 },
    ]);
    expect(qwen.price).toEqual({ inputPerMillionTokens: 0.13, outputPerMillionTokens: 0.6 });
    expect(qwen.params.map((param) => param.key)).toEqual([
      'maxOutputTokens',
      'temperature',
      'webSearch',
      'topK',
      'frequencyPenalty',
      'repetitionPenalty',
      'minP',
      'seed',
    ]);
    expect(auto).not.toHaveProperty('price');
  });

  it('OpenRouter：模型清單有下一頁時繼續讀取', async () => {
    const requests = mockFetch(
      jsonReply({
        data: [OPENROUTER_CLAUDE],
        links: { next: '/api/v1/models?output_modalities=text&offset=1' },
      }),
      jsonReply({ data: [OPENROUTER_QWEN], links: { next: null } }),
    );
    const models = await openRouterConnector.listChatModels(TEST_API_KEY);
    expect(models).toHaveLength(2);
    expect(requests[1].url).toBe(
      'https://openrouter.ai/api/v1/models?output_modalities=text&offset=1',
    );
  });

  it('Claude：分頁讀完模型清單，退役模型不列；回應長度標出平台的預設值；思考程度依支援的等級', async () => {
    const requests = mockFetch(
      jsonReply({ data: [CLAUDE_OPUS], has_more: true, last_id: 'claude-opus-5-5' }),
      jsonReply({
        data: [CLAUDE_HAIKU_OLD, CLAUDE_RETIRED],
        has_more: false,
        last_id: 'claude-2-1',
      }),
    );
    const models = await claudeConnector.listChatModels(TEST_API_KEY);

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5',
    ]);
    expect(models.map((model) => model.id)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5']);
    const [opus, haiku] = models;
    expect(opus.params).toEqual([
      {
        key: 'maxOutputTokens',
        kind: 'number',
        min: 1,
        max: 128000,
        isInteger: true,
        default: 16000,
      },
      {
        key: 'reasoningEffort',
        kind: 'select',
        options: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      { key: 'webSearch', kind: 'boolean', default: false },
    ]);
    expect(opus).not.toHaveProperty('price');
    // spec：網頁搜尋不支援的模型沒有網頁搜尋參數；只能指定思考 token 數的舊模型列低、中、高
    expect(haiku.params.map((param) => param.key)).toEqual(['maxOutputTokens', 'reasoningEffort']);
    expect(haiku.params[1]).toEqual({
      key: 'reasoningEffort',
      kind: 'select',
      options: ['low', 'medium', 'high'],
    });
  });

  it('Gemini：只列能 generateContent 的對話模型（含分頁），思考程度只給會思考的模型', async () => {
    const requests = mockFetch(
      jsonReply({
        models: [GEMINI_FLASH, GEMINI_EMBEDDING, GEMINI_IMAGE],
        nextPageToken: 'page-2',
      }),
      jsonReply({ models: [GEMINI_OLD] }),
    );
    const models = await geminiConnector.listChatModels(TEST_API_KEY);

    expect(requests.map((request) => request.url)).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=page-2',
    ]);
    expect(models.map((model) => model.id)).toEqual(['gemini-3.6-flash', 'gemini-2.0-flash']);
    const [flash, old] = models;
    expect(flash).toMatchObject({
      displayName: 'Gemini 3.6 Flash',
      description: 'Fast and capable',
    });
    expect(flash.params).toEqual([
      { key: 'maxOutputTokens', kind: 'number', min: 1, max: 65536, isInteger: true },
      { key: 'reasoningEffort', kind: 'select', options: ['low', 'medium', 'high'] },
      { key: 'webSearch', kind: 'boolean', default: false },
    ]);
    expect(old.params.map((param) => param.key)).toEqual(['maxOutputTokens', 'webSearch']);
  });
});
