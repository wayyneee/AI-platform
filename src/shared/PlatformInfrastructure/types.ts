// PlatformInfrastructure 對外的資料型別：前端、後端與其他模組都依這裡的形狀交換資料。

// ===== 錯誤物件 =====

/** 本專案的錯誤格式（conventions.md 第 9 段）；HTTP 回應一律是 `{ error: PlatformError }`。 */
export interface PlatformError {
  /** 出錯的核心模組，例如 `PlatformInfrastructure` */
  module: string;
  /** 出錯的介面名稱，例如 `openDatabase` */
  interfaceName: string;
  /** 大寫加底線、前面加功能名稱，全平台不重複，例如 `MODEL_KEY_INVALID` */
  code: string;
  /** 寫給開發者看：在哪一步、為什麼失敗 */
  message: string;
  /** 供應商原始回應、HTTP 狀態等具體內容；不含程式堆疊、key、SQL 參數 */
  details?: unknown;
}

/** 錯誤回應的內容。 */
export interface ErrorResponse {
  error: PlatformError;
}

// ===== 系統 log =====

/** log 等級：正確、警告（使用者造成的失敗）、錯誤（系統或外部造成的失敗）。 */
export type LogLevel = 'success' | 'warning' | 'error';

/** 寫入 log 時提供的內容；時間與編號由 SystemLog 補上。 */
export interface LogInput {
  level: LogLevel;
  /** 發起這件事的核心模組 */
  module: string;
  /** 做了什麼，一句繁體中文，例如「測試模型：GPT-5」 */
  action: string;
  /** 結果的狀態文字，例如「已取消」 */
  status?: string;
  /** 耗時（毫秒） */
  durationMs?: number;
  /** 用量的文字說明，例如「輸入 120 token、輸出 30 token」 */
  usage?: string;
  /** 使用的 API key 名稱（只記名稱，不記 key） */
  keyName?: string;
  /** 失敗時的錯誤物件 */
  error?: PlatformError;
}

/** 一筆系統 log。 */
export interface LogEntry extends LogInput {
  id: string;
  /** ISO 8601（含時區） */
  time: string;
}

// ===== 主題與語言 =====

/** 沒有設定時使用的主題；主題載入失敗時也改用它。 */
export const DEFAULT_THEME = 'default';
/** 沒有設定時使用的語言（conventions.md 第 9 段：預設語言 zh-TW）。 */
export const DEFAULT_LANGUAGE = 'zh-TW';
/** 平台有文字表的語言；新增語言時在這裡加上語言代碼，並在各模組的 texts/ 加一份文字表。 */
export const SUPPORTED_LANGUAGES: readonly string[] = ['zh-TW'];

/** 平台設定：主題資料夾名稱、語言代碼。 */
export interface PlatformSettings {
  theme: string;
  language: string;
}

/** 設定可以選的值。 */
export interface SettingOptions {
  /** 含有 theme.css 的主題資料夾名稱 */
  themes: string[];
  /** 語言代碼 */
  languages: string[];
}

// ===== 供應商與模型 =====

/** 平台支援的供應商；Forge 是本機服務，不需要 key。 */
export type ProviderId = 'openai' | 'gemini' | 'claude' | 'grok' | 'openrouter' | 'forge';

/** 需要 API key 的供應商（Forge 填位址，不需要 key）；API key 分頁的供應商選單只列這些。 */
export const PROVIDERS_REQUIRING_KEY: readonly ProviderId[] = [
  'openai',
  'gemini',
  'claude',
  'grok',
  'openrouter',
];

// ===== API key =====

/** 一組已儲存的 API key；前端只拿得到遮罩值，完整的 key 不離開後端。 */
export interface ApiKeySummary {
  id: string;
  provider: ProviderId;
  name: string;
  /** 長度 12 以上為前 3 碼 + `****` + 後 4 碼，未滿 12 只有 `****` */
  maskedKey: string;
}

/** 新增一組 API key 時送出的內容。 */
export interface NewApiKey {
  provider: ProviderId;
  name: string;
  keyValue: string;
}

/** 修改一組 API key：名稱和 key 值可以改，供應商不能改；keyValue 留空或不給代表 key 不變。 */
export interface ApiKeyChanges {
  id: string;
  name: string;
  keyValue?: string;
}

/** 模型類型：LLM、圖片、影片、語音。 */
export type ModelType = 'llm' | 'image' | 'video' | 'audio';

/** 一項能力的狀態：支援、不支援、未知（供應商沒有提供資料）。 */
export type CapabilitySupport = 'yes' | 'no' | 'unknown';

/** LLM 的七項能力；兩個上限是數字，供應商沒提供時為 null（未知）。 */
export interface LlmCapabilities {
  /** 傳圖片 */
  imageInput: CapabilitySupport;
  /** 傳檔案（目前是 PDF） */
  fileInput: CapabilitySupport;
  webSearch: CapabilitySupport;
  thinking: CapabilitySupport;
  /** 調用工具 */
  tools: CapabilitySupport;
  /** context window 上限（token） */
  contextWindow: number | null;
  /** 輸出上限（token） */
  maxOutputTokens: number | null;
}

/** 一個可調參數的定義；顯示名稱由文字表依 key 取得。 */
export type ParamDefinition =
  | {
      key: string;
      kind: 'number';
      min?: number;
      max?: number;
      /** 只能是整數 */
      isInteger?: boolean;
      default?: number;
    }
  | { key: string; kind: 'boolean'; default?: boolean }
  | {
      key: string;
      kind: 'select';
      options: string[];
      default?: string;
      /** 選項向供應商即時查詢（例如 Grok 的聲音、Forge 的取樣器）；存下的定義 options 是空的，查詢參數時才填入 */
      hasLiveOptions?: boolean;
    }
  | {
      /** 可以選多個、每個各自調權重（Forge 的 LoRA） */
      key: string;
      kind: 'weightedList';
      options: string[];
      weight: { min: number; max: number; default: number };
      hasLiveOptions?: boolean;
    };

/** weightedList 參數的一項：選了哪個、權重多少。 */
export interface WeightedChoice {
  name: string;
  weight: number;
}

/** 一個參數的值。 */
export type ParamValue = number | string | boolean | WeightedChoice[];

/** 呼叫時帶的參數值，key 對應 ParamDefinition.key。 */
export type ParamValues = Record<string, ParamValue>;

/** 平台共通的 LLM 參數 key；OpenRouter 另外有它回報的參數（見 ProviderConnectors）。 */
export const LLM_PARAM_KEYS = {
  maxOutputTokens: 'maxOutputTokens',
  temperature: 'temperature',
  reasoningEffort: 'reasoningEffort',
  webSearch: 'webSearch',
} as const;

// ===== LLM 對話 =====

/** 對話中附上的檔案；data 是 base64（不含 data: 前綴）。 */
export interface ChatAttachment {
  kind: 'image' | 'pdf';
  /** 例如 image/png、application/pdf */
  mimeType: string;
  data: string;
  /** PDF 的檔名；部分供應商需要 */
  fileName?: string;
}

/** 呼叫端提供給模型的工具；parameters 是 JSON Schema（type: object）。 */
export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 模型要求使用的工具：哪個工具、帶什麼內容。本模組不執行，交給呼叫端。 */
export interface ChatToolCall {
  /** 送回工具結果時要帶的編號 */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 呼叫端執行工具後送回的結果。 */
export interface ChatToolResult {
  /** 對應 ChatToolCall.id */
  callId: string;
  /** 對應 ChatToolCall.name；部分供應商（Gemini）需要 */
  name: string;
  /** 結果文字（可以是 JSON 字串） */
  content: string;
}

/**
 * 供應商回傳的原始內容（思考簽章、加密推理內容等）。
 * 呼叫端不用看懂，跟著那則回覆存起來，下一輪原樣送回；換了供應商或模型時本模組自動略過。
 */
export interface ProviderReplay {
  provider: ProviderId;
  model: string;
  data: unknown;
}

/** 對話中的一則訊息。 */
export type ChatMessage =
  | { role: 'user'; text: string; attachments?: ChatAttachment[] }
  | {
      role: 'assistant';
      text: string;
      toolCalls?: ChatToolCall[];
      /** 上一輪結果的 replay，原樣放回來 */
      replay?: ProviderReplay;
    }
  | { role: 'tool'; results: ChatToolResult[] };

/** 送給 LLM 的內容。 */
export interface ChatInput {
  systemPrompt?: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
}

/** 網頁搜尋的來源。 */
export interface SearchSource {
  url: string;
  title?: string;
}

/** 一次 LLM 呼叫的用量。 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** 網頁搜尋次數 */
  searchCount: number;
  /** 供應商直接回報的搜尋金額（美元，目前只有 OpenRouter） */
  reportedSearchCostUsd?: number;
}

/** 結束原因：正常結束、達到輸出上限、要求使用工具、被供應商拒絕、其他。 */
export type ChatFinishReason = 'stop' | 'length' | 'toolCalls' | 'refused' | 'other';

/** 一次 LLM 呼叫的完整結果；回覆文字、思考內容、工具請求、搜尋來源分開交給呼叫端。 */
export interface ChatResult {
  text: string;
  thinking: string;
  toolCalls: ChatToolCall[];
  sources: SearchSource[];
  usage: LlmUsage;
  finishReason: ChatFinishReason;
  /** 下一輪要原樣送回的供應商原始內容 */
  replay: ProviderReplay;
}

/** 串流的一段：逐段的回覆文字、思考內容，最後一段帶完整結果。 */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; result: ChatResult };

// ===== 圖片、影片、語音 =====

/** 非 LLM 的模型類型。 */
export type MediaModelType = Exclude<ModelType, 'llm'>;

/** 平台內建的圖片、影片、語音參數 key（spec：依各家官方文件內建）；各家只列出它支援的。 */
export const MEDIA_PARAM_KEYS = {
  /** 張數 */
  count: 'count',
  aspectRatio: 'aspectRatio',
  resolution: 'resolution',
  quality: 'quality',
  seed: 'seed',
  /** 影片秒數 */
  duration: 'duration',
  /** 影片是否一起生成聲音 */
  generateAudio: 'generateAudio',
  voice: 'voice',
  language: 'language',
  /** 語速 */
  speed: 'speed',
  // 以下是 Forge 的參數
  width: 'width',
  height: 'height',
  steps: 'steps',
  cfgScale: 'cfgScale',
  sampler: 'sampler',
  scheduler: 'scheduler',
  /** 改圖時偏離原圖的程度 */
  denoisingStrength: 'denoisingStrength',
  loras: 'loras',
} as const;

/** 送給圖片、影片模型的圖片；data 是 base64（不含 data: 前綴）。 */
export interface MediaImage {
  /** 例如 image/png */
  mimeType: string;
  data: string;
}

/** 送給圖片、影片、語音模型的內容。 */
export interface MediaInput {
  /** 圖片、影片：提示詞；語音：要念的文字 */
  prompt: string;
  /** 不想出現的內容（目前只有 Forge 使用） */
  negativePrompt?: string;
  /** 圖片：參考圖，有附就是改圖 */
  referenceImages?: MediaImage[];
  /** 影片：第一個畫面，有附就是讓這張圖動起來 */
  firstFrame?: MediaImage;
}

/** 生成出來的一個檔案；由呼叫端存到自己的資料夾。 */
export interface MediaFile {
  /** 例如 image/png、video/mp4、audio/mpeg */
  mimeType: string;
  data: Uint8Array;
}

/** 一次圖片、影片、語音生成的用量；計費單位：圖片以張、影片以秒、語音以輸入字數。 */
export interface MediaUsage {
  imageCount: number;
  videoSeconds: number;
  characterCount: number;
}

/** 圖片、影片、語音生成的結果。 */
export interface MediaResult {
  files: MediaFile[];
  usage: MediaUsage;
}

/** 生成中的進度：排隊中、處理中；percent 只有供應商提供百分比時才有（0～100）。 */
export interface MediaProgress {
  status: 'queued' | 'running';
  percent?: number;
}

// ===== 偵測到的模型 =====

/** 模型可以輸入、輸出的內容類型（新增模型視窗的資訊卡顯示用）。 */
export type ContentKind = 'text' | 'image' | 'video' | 'audio' | 'file';

/** 模型價格（美元）；沒填的欄位代表只統計用量。 */
export interface ModelPrice {
  /** LLM：每 100 萬輸入 token */
  inputPerMillionTokens?: number;
  /** LLM：每 100 萬輸出 token */
  outputPerMillionTokens?: number;
  /** LLM：每次網頁搜尋 */
  perSearch?: number;
  /** 圖片：每張；影片：每秒；語音：每 100 萬字 */
  perUnit?: number;
}

/** 向供應商偵測到的一個模型：能力、自動帶入的價格、可調參數。 */
export interface DetectedModel {
  /** 供應商的模型名稱，呼叫時用這個 */
  id: string;
  displayName: string;
  description?: string;
  type: ModelType;
  /** LLM 才有 */
  capabilities?: LlmCapabilities;
  /** 抓得到價格的供應商才有（OpenRouter、Grok 的 LLM） */
  price?: ModelPrice;
  params: ParamDefinition[];
  /** 圖片、影片、語音：可以輸入、輸出的類型（供應商有提供才有） */
  inputKinds?: ContentKind[];
  outputKinds?: ContentKind[];
}

// ===== 已儲存的模型 =====

/** 各類型有哪些供應商（spec：OpenAI、Gemini、Claude 只有 LLM；Forge 只有圖片）；新增模型視窗的供應商選單依這裡列出。 */
export const MODEL_TYPE_PROVIDERS: Readonly<Record<ModelType, readonly ProviderId[]>> = {
  llm: ['openai', 'gemini', 'claude', 'grok', 'openrouter'],
  image: ['grok', 'openrouter', 'forge'],
  video: ['grok', 'openrouter'],
  audio: ['grok', 'openrouter'],
};

/** Forge 的預設位址（新增模型視窗的提示文字）。 */
export const FORGE_DEFAULT_ADDRESS = 'http://127.0.0.1:7860';

/** 怎麼連到某個類型的模型：雲端供應商選已儲存的 key，Forge 填位址。 */
export interface ModelConnectionChoice {
  type: ModelType;
  provider: ProviderId;
  /** 雲端供應商：已儲存的 key 編號 */
  keyId?: string;
  /** Forge：位址，例如 http://127.0.0.1:7860 */
  address?: string;
}

/** 測試一個模型：連線方式加上供應商的模型名稱。 */
export interface ModelTestInput extends ModelConnectionChoice {
  modelId: string;
}

/** 新增模型：要先用同樣的設定測試成功才能儲存（spec 規則）。 */
export interface NewModel extends ModelTestInput {
  displayName: string;
  price: ModelPrice;
}

/** 一個已儲存的模型；其他模組從這裡挑選，依能力決定要用哪些功能。 */
export interface SavedModel {
  id: string;
  type: ModelType;
  provider: ProviderId;
  /** 供應商的模型名稱 */
  modelId: string;
  displayName: string;
  /** 選用的 key；key 被刪除後為 null，要重新選 key 才能使用。Forge 一律為 null */
  keyId: string | null;
  /** Forge 的位址；雲端供應商為 null */
  address: string | null;
  price: ModelPrice;
  /** LLM 的七項能力；其他類型為 null */
  capabilities: LlmCapabilities | null;
  /** 可調參數的定義；即時選項（hasLiveOptions）在這裡是空的，用 getModelParams 查 */
  params: ParamDefinition[];
}
