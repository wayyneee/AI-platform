// 呼叫前檢查參數（spec 規則）：超出範圍或選項不在清單中時回報錯誤；不在定義中的參數略過不送；
// 沒填的參數有預設值用預設值，沒有就不送、交給供應商決定。

import type {
  ParamDefinition,
  ParamValue,
  ParamValues,
  WeightedChoice,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

export const ParamValidationErrorCodes = defineErrorCodes({
  INVOCATION_PARAM_INVALID: 'warning',
});

// ===== 主要流程 =====

/**
 * 依參數定義整理呼叫端給的參數，回傳要送給供應商的參數。
 * 值的型別不對、超出範圍、選項不在清單中時丟出 INVOCATION_PARAM_INVALID。
 */
export function validateParams(
  definitions: ParamDefinition[],
  values: ParamValues,
  interfaceName: string,
): ParamValues {
  const checked: ParamValues = {};
  for (const definition of definitions) {
    const value = values[definition.key];
    if (value === undefined) {
      const fallback = defaultValueOf(definition);
      if (fallback !== undefined) checked[definition.key] = fallback;
      continue;
    }
    const problem = findProblem(definition, value);
    if (problem) throw invalidParamError(definition, value, problem, interfaceName);
    checked[definition.key] = value;
  }
  return checked;
}

// ===== 檢查各種參數 =====

/** 回傳值哪裡不對（給開發者看的說明）；沒問題時回傳 null。 */
function findProblem(definition: ParamDefinition, value: ParamValue): string | null {
  switch (definition.kind) {
    case 'number':
      return findNumberProblem(definition, value);
    case 'boolean':
      return typeof value === 'boolean' ? null : '要是「是」或「否」';
    case 'select':
      return findOptionProblem(definition.options, value);
    case 'weightedList':
      return findWeightedListProblem(definition, value);
  }
}

function findNumberProblem(
  definition: Extract<ParamDefinition, { kind: 'number' }>,
  value: ParamValue,
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '要是數字';
  if (definition.isInteger && !Number.isInteger(value)) return '要是整數';
  return findRangeProblem(value, definition.min, definition.max);
}

function findOptionProblem(options: string[], value: unknown): string | null {
  if (typeof value === 'string' && options.includes(value)) return null;
  return '不在可選的清單中';
}

/** 可以選多個、各自調權重（Forge 的 LoRA）：每一項都要在清單中，權重在範圍內。 */
function findWeightedListProblem(
  definition: Extract<ParamDefinition, { kind: 'weightedList' }>,
  value: ParamValue,
): string | null {
  if (!Array.isArray(value)) return '要是清單';
  for (const choice of value as unknown[]) {
    if (!isWeightedChoice(choice)) return '每一項都要有名稱和權重';
    const optionProblem = findOptionProblem(definition.options, choice.name);
    if (optionProblem) return `「${choice.name}」${optionProblem}`;
    const rangeProblem = findRangeProblem(
      choice.weight,
      definition.weight.min,
      definition.weight.max,
    );
    if (rangeProblem) return `「${choice.name}」的權重${rangeProblem}`;
  }
  return null;
}

function findRangeProblem(value: number, min?: number, max?: number): string | null {
  if (min !== undefined && value < min) return `不能小於 ${min}`;
  if (max !== undefined && value > max) return `不能大於 ${max}`;
  return null;
}

// ===== 輔助 =====

function defaultValueOf(definition: ParamDefinition): ParamValue | undefined {
  return 'default' in definition ? definition.default : undefined;
}

function isWeightedChoice(value: unknown): value is WeightedChoice {
  if (typeof value !== 'object' || value === null) return false;
  const choice = value as Record<string, unknown>;
  return (
    typeof choice.name === 'string' &&
    typeof choice.weight === 'number' &&
    Number.isFinite(choice.weight)
  );
}

function invalidParamError(
  definition: ParamDefinition,
  value: ParamValue,
  problem: string,
  interfaceName: string,
) {
  return createError(
    MODULE_NAME,
    interfaceName,
    ParamValidationErrorCodes.INVOCATION_PARAM_INVALID,
    `參數「${definition.key}」的值${problem}`,
    { key: definition.key, value, definition },
  );
}
