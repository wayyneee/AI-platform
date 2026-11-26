// 每家供應商的串接都長成同一個樣子。ModelRegistry、ModelInvocation 只透過這裡的形狀使用它們：
// LLM 是偵測模型、送出對話、串流對話；圖片、影片、語音是偵測模型、確認模型、查詢即時選項、生成。

import type {
  ChatInput,
  ChatResult,
  ChatStreamEvent,
  DetectedModel,
  MediaInput,
  MediaModelType,
  MediaProgress,
  MediaResult,
  ParamValues,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';

// ===== LLM =====

/** 一次 LLM 呼叫：模型、key、對話內容、參數；signal 用來中止。 */
export interface ChatRequest {
  model: string;
  apiKey: string;
  input: ChatInput;
  /** 已經由 ModelInvocation 檢查過的參數；不在定義中的已經略過 */
  params: ParamValues;
  signal?: AbortSignal;
}

/** 一家供應商的 LLM 串接。 */
export interface ProviderConnector {
  provider: ProviderId;
  /** 用這組 key 偵測可用的 LLM 模型，含能力、自動帶入的價格、可調參數 */
  listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]>;
  /** 送出對話並取得完整結果 */
  sendChat(request: ChatRequest): Promise<ChatResult>;
  /** 串流對話：逐段送出回覆文字與思考內容，最後一段是完整結果；呼叫端中止時丟出 PROVIDER_CANCELLED */
  streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent>;
}

// ===== 圖片、影片、語音 =====

/** 怎麼連到供應商：雲端供應商用 key，Forge 用位址。 */
export interface MediaConnection {
  apiKey?: string;
  /** Forge 的位址，例如 http://127.0.0.1:7860 */
  address?: string;
}

/** 一次圖片、影片、語音生成。 */
export interface MediaRequest {
  type: MediaModelType;
  model: string;
  connection: MediaConnection;
  input: MediaInput;
  /** 已經由 ModelInvocation 檢查過、補上預設值的參數 */
  params: ParamValues;
  /** 中止生成；影片超過 30 分鐘由 ModelInvocation 中止 */
  signal?: AbortSignal;
  /** 生成中的進度；供應商有提供才會呼叫 */
  onProgress?: (progress: MediaProgress) => void;
}

/** 一家供應商的圖片、影片、語音串接。 */
export interface MediaConnector {
  provider: ProviderId;
  /** 這家提供哪些類型 */
  types: MediaModelType[];
  /** 偵測這個類型可用的模型，含可調參數、可輸入與輸出的類型 */
  listMediaModels(
    type: MediaModelType,
    connection: MediaConnection,
    signal?: AbortSignal,
  ): Promise<DetectedModel[]>;
  /** 測試用：只確認連得上、key 有效、模型存在，不實際生成（spec：測試不花錢）；不通過時丟出錯誤 */
  checkMediaModel(
    type: MediaModelType,
    model: string,
    connection: MediaConnection,
    signal?: AbortSignal,
  ): Promise<void>;
  /** 查詢 hasLiveOptions 參數目前的選項（例如 Grok 的聲音、Forge 的 LoRA） */
  listParamOptions(
    type: MediaModelType,
    model: string,
    paramKey: string,
    connection: MediaConnection,
    signal?: AbortSignal,
  ): Promise<string[]>;
  /** 送出、追蹤進度、取回結果，一次做完；呼叫端中止時丟出 PROVIDER_CANCELLED */
  generateMedia(request: MediaRequest): Promise<MediaResult>;
}
