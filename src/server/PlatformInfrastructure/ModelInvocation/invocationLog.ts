// 一次呼叫、一次串流、一個任務各寫一筆 log（spec 驗收條件），在事情結束時寫：成功、失敗、被中止都算結束。
// 成功時順便記錄用量：已經拿到結果、但記錄用量失敗時照常回傳結果（不讓已花的錢白費），log 為錯誤並註明。

import type {
  LlmUsage,
  LogLevel,
  MediaUsage,
  PlatformError,
  UsageCost,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { describeKey, describeModel } from '../ModelRegistry/index.ts';
import {
  createError,
  defineErrorCodes,
  getErrorLevel,
  isPlatformError,
  writeLog,
} from '../SystemLog/index.ts';
import { recordUsage } from '../UsageAndCost/index.ts';
import type { PreparedInvocation } from './invocationSetup.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const USAGE_RECORD_FAILED_STATUS = '已取得結果，但用量記錄失敗';
const STOPPED_STATUS = '已中止';
const COST_DECIMALS = 4;

export const InvocationLogErrorCodes = defineErrorCodes({
  INVOCATION_UNEXPECTED_ERROR: 'error',
});

/** 這件事是哪一種呼叫，寫在 log 的「做了什麼」。 */
export type InvocationAction = '呼叫模型' | '串流呼叫模型' | '生成任務';

/** log 上除了等級以外、各種結束方式會寫的內容。 */
interface LogFields {
  status?: string;
  usage?: string;
  error?: PlatformError;
}

// ===== 主要流程 =====

/** 開始一件事的 log；log 的模組欄寫成「呼叫的模組 → PlatformInfrastructure」（spec 規則）。 */
export function startInvocationLog(
  callerModule: string,
  action: InvocationAction,
  modelId: string,
): InvocationLog {
  return new InvocationLog(callerModule, action, modelId);
}

/** 一件事的 log：準備好模型後補上名稱，結束時寫一筆。 */
export class InvocationLog {
  private readonly startedAt = Date.now();
  private readonly module: string;
  private readonly action: InvocationAction;
  private target: string;
  private keyName?: string;

  constructor(callerModule: string, action: InvocationAction, modelId: string) {
    this.action = action;
    this.module = `${callerModule} → ${MODULE_NAME}`;
    this.target = `編號 ${modelId} 的模型`;
  }

  /** 找到模型後補上模型名稱與 key 名稱。 */
  setTarget(prepared: PreparedInvocation): void {
    const { model, connection } = prepared;
    this.target = describeModel(model.displayName, model.provider, model.type);
    this.keyName = connection.keyName ? describeKey(model.provider, connection.keyName) : undefined;
  }

  /** 成功：記錄用量並寫一筆 log，回傳花費；Forge 或記錄用量失敗時回傳 null。 */
  succeed(prepared: PreparedInvocation, usage: LlmUsage | MediaUsage): UsageCost | null {
    const recorded = recordUsageSafely(prepared, usage);
    const usageText = describeUsage(prepared, usage, recorded.cost);
    if (recorded.error) {
      this.write('error', {
        status: USAGE_RECORD_FAILED_STATUS,
        usage: usageText,
        error: recorded.error,
      });
    } else {
      this.write('success', { usage: usageText });
    }
    return recorded.cost;
  }

  /** 失敗：寫一筆 log，回傳要往外丟的錯誤物件（意外錯誤轉成 INVOCATION_UNEXPECTED_ERROR）。 */
  fail(error: unknown, interfaceName: string): PlatformError {
    const platformError = toInvocationError(error, interfaceName);
    this.write(getErrorLevel(platformError.code), { error: platformError });
    return platformError;
  }

  /** 呼叫端不再讀取串流：視為中止，不記錄用量。 */
  stop(): void {
    // 使用者自己中止屬於使用者造成的結束，等級為警告（conventions.md 第 9 段）
    this.write('warning', { status: STOPPED_STATUS });
  }

  private write(level: LogLevel, fields: LogFields): void {
    writeLog({
      level,
      module: this.module,
      action: `${this.action}：${this.target}`,
      durationMs: Date.now() - this.startedAt,
      keyName: this.keyName,
      ...fields,
    });
  }
}

/** 已經是錯誤物件就原樣回傳；程式的意外錯誤在介面邊界轉成本專案的錯誤格式。 */
export function toInvocationError(error: unknown, interfaceName: string): PlatformError {
  if (isPlatformError(error)) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return createError(
    MODULE_NAME,
    interfaceName,
    InvocationLogErrorCodes.INVOCATION_UNEXPECTED_ERROR,
    `呼叫模型時發生未預期的錯誤：${reason}`,
  );
}

// ===== 記錄用量 =====

/** 記錄用量；失敗時不往外丟，交給 log 註明（spec 規則）。Forge 不記錄，花費為 null。 */
function recordUsageSafely(
  prepared: PreparedInvocation,
  usage: LlmUsage | MediaUsage,
): { cost: UsageCost | null; error?: PlatformError } {
  try {
    const cost = recordUsage({
      model: prepared.model,
      keyId: prepared.connection.keyId,
      keyName: prepared.connection.keyName,
      usage,
    });
    return { cost };
  } catch (error) {
    return { cost: null, error: toInvocationError(error, 'recordUsage') };
  }
}

// ===== log 的文字 =====

/** 用量的文字，例如「輸入 120 token、輸出 30 token、搜尋 1 次，約 US$0.0012」。 */
function describeUsage(
  prepared: PreparedInvocation,
  usage: LlmUsage | MediaUsage,
  cost: UsageCost | null,
): string {
  const amount = describeAmount(prepared.model.type, usage);
  if (!cost?.hasPricedUsage) return amount;
  return `${amount}，約 US$${cost.costUsd.toFixed(COST_DECIMALS)}`;
}

function describeAmount(type: PreparedInvocation['model']['type'], usage: LlmUsage | MediaUsage) {
  if (type === 'llm') {
    const llmUsage = usage as LlmUsage;
    const tokens = `輸入 ${llmUsage.inputTokens} token、輸出 ${llmUsage.outputTokens} token`;
    return llmUsage.searchCount > 0 ? `${tokens}、搜尋 ${llmUsage.searchCount} 次` : tokens;
  }
  const mediaUsage = usage as MediaUsage;
  if (type === 'image') return `${mediaUsage.imageCount} 張`;
  if (type === 'video') return `${mediaUsage.videoSeconds} 秒`;
  return `${mediaUsage.characterCount} 字`;
}
