// 模型偵測測試共用的範例資料：依各家官方文件的模型清單形狀。只給測試使用。

export const ALL_UNKNOWN = {
  imageInput: 'unknown',
  fileInput: 'unknown',
  webSearch: 'unknown',
  thinking: 'unknown',
  tools: 'unknown',
  contextWindow: null,
  maxOutputTokens: null,
};

export const OPENROUTER_CLAUDE = {
  id: 'anthropic/claude-sonnet-5.5',
  name: 'Anthropic: Claude Sonnet 5.5',
  description: 'Claude Sonnet 5.5 via OpenRouter',
  context_length: 1000000,
  architecture: {
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    output_modalities: ['text'],
  },
  pricing: { prompt: '0.000002', completion: '0.00001', request: '0', web_search: '0.01' },
  top_provider: { context_length: 1000000, max_completion_tokens: 128000, is_moderated: false },
  supported_parameters: [
    'max_tokens',
    'temperature',
    'tools',
    'tool_choice',
    'reasoning',
    'include_reasoning',
    'top_p',
    'stop',
  ],
  reasoning: {
    mandatory: false,
    default_enabled: true,
    supported_efforts: ['high', 'medium', 'low'],
  },
};

export const OPENROUTER_QWEN = {
  id: 'qwen/qwen3-235b-a22b',
  name: 'Qwen: Qwen3 235B A22B',
  context_length: 131072,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt: '0.00000013', completion: '0.0000006' },
  top_provider: { max_completion_tokens: null },
  supported_parameters: [
    'max_tokens',
    'temperature',
    'top_k',
    'min_p',
    'repetition_penalty',
    'seed',
    'frequency_penalty',
  ],
};

export const OPENROUTER_AUTO = {
  id: 'openrouter/auto',
  name: 'Auto Router',
  context_length: 2000000,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  pricing: { prompt: '-1', completion: '-1' },
  supported_parameters: ['max_tokens'],
};

export const CLAUDE_OPUS = {
  type: 'model',
  id: 'claude-opus-5-5',
  display_name: 'Claude Opus 5.5',
  lifecycle: 'active',
  max_input_tokens: 1000000,
  max_tokens: 128000,
  capabilities: {
    image_input: { supported: true },
    pdf_input: { supported: true },
    server_tools: {
      supported: true,
      web_search: { supported: true },
      code_execution: { supported: true },
    },
    thinking: {
      supported: true,
      types: { adaptive: { supported: true }, enabled: { supported: false } },
    },
    effort: {
      supported: true,
      low: { supported: true },
      medium: { supported: true },
      high: { supported: true },
      xhigh: { supported: true },
      max: { supported: true },
    },
  },
};

export const CLAUDE_HAIKU_OLD = {
  type: 'model',
  id: 'claude-haiku-4-5',
  display_name: 'Claude Haiku 4.5',
  lifecycle: 'active',
  max_input_tokens: 200000,
  max_tokens: 64000,
  capabilities: {
    image_input: { supported: true },
    pdf_input: { supported: true },
    server_tools: { supported: false, web_search: { supported: false } },
    thinking: {
      supported: true,
      types: { adaptive: { supported: false }, enabled: { supported: true } },
    },
    effort: { supported: false, low: { supported: false } },
  },
};

export const CLAUDE_RETIRED = { ...CLAUDE_HAIKU_OLD, id: 'claude-2-1', lifecycle: 'retired' };

export const GEMINI_FLASH = {
  name: 'models/gemini-3.6-flash',
  displayName: 'Gemini 3.6 Flash',
  description: 'Fast and capable',
  inputTokenLimit: 1048576,
  outputTokenLimit: 65536,
  supportedGenerationMethods: ['generateContent', 'countTokens'],
  thinking: true,
};

export const GEMINI_OLD = {
  name: 'models/gemini-2.0-flash',
  displayName: 'Gemini 2.0 Flash',
  inputTokenLimit: 1048576,
  outputTokenLimit: 8192,
  supportedGenerationMethods: ['generateContent'],
  thinking: false,
};

export const GEMINI_EMBEDDING = {
  name: 'models/text-embedding-004',
  supportedGenerationMethods: ['embedContent'],
};
export const GEMINI_IMAGE = {
  name: 'models/gemini-2.5-flash-image',
  supportedGenerationMethods: ['generateContent'],
};
