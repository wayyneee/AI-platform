// 每家供應商的串接都長成同一個樣子：偵測模型、送出對話、串流對話。ModelRegistry、ModelInvocation 只透過這個形狀使用它們。

import type {
  ChatInput,
  ChatResult,
  ChatStreamEvent,
  DetectedModel,
  ParamValues,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';

/** 一次 LLM 呼叫：模型、key、對話內容、參數；signal 用來中止。 */
export interface ChatRequest {
  model: string;
  apiKey: string;
  input: ChatInput;
  /** 已經由 ModelInvocation 檢查過的參數；不在定義中的已經略過 */
  params: ParamValues;
  signal?: AbortSignal;
}

/** 一家供應商的串接。 */
export interface ProviderConnector {
  provider: ProviderId;
  /** 用這組 key 偵測可用的 LLM 模型，含能力、自動帶入的價格、可調參數 */
  listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]>;
  /** 送出對話並取得完整結果 */
  sendChat(request: ChatRequest): Promise<ChatResult>;
  /** 串流對話：逐段送出回覆文字與思考內容，最後一段是完整結果；呼叫端中止時丟出 PROVIDER_CANCELLED */
  streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent>;
}
