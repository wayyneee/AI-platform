// API 串接的「模型」分頁：LLM、圖片、影片、語音四個區塊，每列可以換 key、測試、刪除；
// 「新增模型」打開新增模型視窗。按儲存時把改選 key 的模型存起來，key 沒選的列紅框、不送出。

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type {
  ApiKeySummary,
  ModelType,
  PlatformError,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { useLeaveGuard } from '../AppShell/index.ts';
import { deleteModel, listModels, testModel, updateModelKey } from '../ModelRegistry/index.ts';
import {
  Badge,
  Button,
  joinClassNames,
  Select,
  showConfirm,
  showError,
  showToast,
} from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { openAddModelDialog } from './AddModelDialog.tsx';
import { describeModelPrice } from './modelDisplay.ts';
import { SaveBar, type SaveFeedback } from './settingsPageParts.tsx';

const MODULE_NAME = 'PlatformInfrastructure';
const MODEL_TYPES: ModelType[] = ['llm', 'image', 'video', 'audio'];
const FORGE_PROVIDER = 'forge';

/** 模型列表的更新方式：給新的清單，或由目前的清單算出新的。 */
export type ModelsUpdate = (models: SavedModel[]) => SavedModel[];

interface ModelPanelProps {
  savedKeys: ApiKeySummary[];
  models: SavedModel[];
  onModelsChange: (update: ModelsUpdate) => void;
  /** 回報有沒有未儲存的修改，讓頁面在切換分頁前詢問 */
  onDirtyChange: (isDirty: boolean) => void;
}

/** 一列送出換 key 後的結果。 */
type KeySaveResult = { model: SavedModel } | { error: PlatformError };

// ===== 分頁 =====

/** 模型分頁：四個類型的區塊和儲存列。 */
export function ModelPanel({ savedKeys, models, onModelsChange, onDirtyChange }: ModelPanelProps) {
  const editor = useModelKeyEditor(models, onModelsChange);
  useLeaveGuard(editor.isDirty);
  useEffect(() => onDirtyChange(editor.isDirty), [editor.isDirty, onDirtyChange]);

  const openDialog = (type: ModelType) =>
    openAddModelDialog({ type, savedKeys, onSaved: () => reloadModels(onModelsChange) });

  return (
    <>
      {MODEL_TYPES.map((type) => (
        <ModelSection
          key={type}
          type={type}
          models={models.filter((model) => model.type === type)}
          savedKeys={savedKeys}
          editor={editor}
          onAdd={() => openDialog(type)}
        />
      ))}
      <SaveBar
        feedback={editor.feedback}
        isDirty={editor.isDirty}
        isSaving={editor.isSaving}
        onSave={editor.save}
      />
    </>
  );
}

// ===== 編輯狀態 =====

type ModelKeyEditor = ReturnType<typeof useModelKeyEditor>;

/**
 * 每列選的 key：只記使用者改過的列（keyDrafts），改回原樣就移除，所以「有沒有修改」直接看它是不是空的。
 * 模型列表重新載入時，沒改過的列自動跟著新的資料。
 */
function useModelKeyEditor(
  models: SavedModel[],
  onModelsChange: ModelPanelProps['onModelsChange'],
) {
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<SaveFeedback>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedKeyOf = (model: SavedModel) => keyDrafts[model.id] ?? model.keyId ?? '';

  const chooseKey = (model: SavedModel, keyId: string) => {
    setKeyDrafts((current) =>
      withDraft(current, model.id, keyId === (model.keyId ?? '') ? null : keyId),
    );
    setRowErrors((current) => withDraft(current, model.id, null));
    setFeedback(null);
  };

  /** 模型刪除後：拿掉這列的修改，從列表移除。 */
  const removeModel = (modelId: string) => {
    setKeyDrafts((current) => withDraft(current, modelId, null));
    setRowErrors((current) => withDraft(current, modelId, null));
    onModelsChange((current) => current.filter((model) => model.id !== modelId));
  };

  const save = async () => {
    const changed = models.filter((model) => model.id in keyDrafts);
    const toSend = changed.filter((model) => keyDrafts[model.id] !== '');
    if (toSend.length === 0) {
      setFeedback({ text: getText('PlatformInfrastructure.models.fixRequired'), tone: 'danger' });
      return;
    }
    setIsSaving(true);
    const results = await sendKeyChanges(toSend, keyDrafts);
    setIsSaving(false);
    applySaveResults(results, { onModelsChange, setKeyDrafts, setRowErrors });
    setFeedback(describeSaveOutcome(results, toSend.length < changed.length));
  };

  const isDirty = Object.keys(keyDrafts).length > 0;
  return {
    keyDrafts,
    rowErrors,
    feedback,
    isSaving,
    isDirty,
    selectedKeyOf,
    chooseKey,
    removeModel,
    save,
  };
}

// ===== 區塊 =====

interface ModelSectionProps {
  type: ModelType;
  models: SavedModel[];
  savedKeys: ApiKeySummary[];
  editor: ModelKeyEditor;
  onAdd: () => void;
}

/** 一個類型的區塊：標題列（類型名稱、模型數量、新增模型）和模型列；沒有模型時一行小字。 */
function ModelSection({ type, models, savedKeys, editor, onAdd }: ModelSectionProps) {
  const typeName = getText(`PlatformInfrastructure.modelType.${type}`);
  return (
    <section className="platform-infrastructure-card" aria-label={typeName}>
      <div className="platform-infrastructure-card-header">
        <h2 className="platform-infrastructure-card-title">
          {typeName}
          <span className="platform-infrastructure-eyebrow">
            {getText(`PlatformInfrastructure.modelTypeEyebrow.${type}`)}
          </span>
        </h2>
        <Badge>{getText('PlatformInfrastructure.models.count', { count: models.length })}</Badge>
        <span className="platform-infrastructure-card-header-spacer" />
        <Button variant="secondary" isSmall onClick={onAdd}>
          {getText('PlatformInfrastructure.models.add')}
        </Button>
      </div>
      {models.length === 0 ? (
        <div className="platform-infrastructure-model-empty">
          {getText('PlatformInfrastructure.models.empty', { type: typeName })}
        </div>
      ) : (
        models.map((model) => (
          <ModelRow key={model.id} model={model} savedKeys={savedKeys} editor={editor} />
        ))
      )}
    </section>
  );
}

// ===== 模型列 =====

interface ModelRowProps {
  model: SavedModel;
  savedKeys: ApiKeySummary[];
  editor: ModelKeyEditor;
}

/** 一列：顯示名稱與模型名稱、供應商、連線、價格、測試與刪除。 */
function ModelRow({ model, savedKeys, editor }: ModelRowProps) {
  const [isTesting, setIsTesting] = useState(false);
  const isForge = model.provider === FORGE_PROVIDER;
  const selectedKey = editor.selectedKeyOf(model);
  const hasProviderKeys = savedKeys.some((key) => key.provider === model.provider);
  const isTestable = isForge || (hasProviderKeys && selectedKey !== '');

  const runTest = async () => {
    setIsTesting(true);
    await testWithCurrentSettings(model, selectedKey);
    setIsTesting(false);
  };

  return (
    <div className="platform-infrastructure-model-row">
      <div>
        <div className="platform-infrastructure-model-name">{model.displayName}</div>
        <span className="platform-infrastructure-model-id" title={model.modelId}>
          {model.modelId}
        </span>
      </div>
      <div>
        <Badge tone="primary">{getText(`PlatformInfrastructure.provider.${model.provider}`)}</Badge>
      </div>
      <div className="platform-infrastructure-model-connection">
        <ModelConnection model={model} savedKeys={savedKeys} editor={editor} />
      </div>
      <ModelPrice model={model} />
      <div className="platform-infrastructure-model-actions">
        <Button
          variant="secondary"
          isSmall
          isDisabled={!isTestable}
          isBusy={isTesting}
          busyLabel={getText('PlatformInfrastructure.models.testing')}
          onClick={() => void runTest()}
        >
          {getText('PlatformInfrastructure.models.test')}
        </Button>
        <Button variant="subtleDanger" isSmall onClick={() => void confirmAndDelete(model, editor)}>
          {getText('PlatformInfrastructure.models.delete')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 連線：Forge 顯示位址；雲端模型選同供應商的 key；該供應商沒有任何 key 時改為提示。
 * key 為空時紅框：被刪除時提示重新選擇，自己選回未選時提示「請選擇 key」。
 */
function ModelConnection({ model, savedKeys, editor }: ModelRowProps) {
  if (model.provider === FORGE_PROVIDER) {
    return <div className="platform-infrastructure-model-address">{model.address}</div>;
  }
  const providerName = getText(`PlatformInfrastructure.provider.${model.provider}`);
  const keys = savedKeys.filter((key) => key.provider === model.provider);
  if (keys.length === 0) {
    return (
      <div className="platform-infrastructure-row-error">
        {getText('PlatformInfrastructure.models.noKeyForProvider', { provider: providerName })}
      </div>
    );
  }
  const selectedKey = editor.selectedKeyOf(model);
  const errorText = editor.rowErrors[model.id] ?? describeMissingKey(model, editor);
  return (
    <>
      <Select
        value={selectedKey}
        options={keys.map((key) => ({ value: key.id, label: key.name, hint: key.maskedKey }))}
        onChange={(keyId) => editor.chooseKey(model, keyId)}
        hasPlaceholder
        isInvalid={selectedKey === '' || Boolean(editor.rowErrors[model.id])}
        ariaLabel={getText('PlatformInfrastructure.models.keyLabel', { name: model.displayName })}
      />
      {errorText && <div className="platform-infrastructure-row-error">{errorText}</div>}
    </>
  );
}

function ModelPrice({ model }: { model: SavedModel }) {
  const price = describeModelPrice(model.type, model.provider, model.price);
  return (
    <div
      className={joinClassNames('platform-infrastructure-model-price', price.isUnset && 'is-unset')}
    >
      {price.text}
      {price.note && <small>{price.note}</small>}
    </div>
  );
}

// ===== 測試、刪除 =====

/** 用這列目前的設定（含還沒儲存的 key）測試；成功提示，失敗顯示錯誤。 */
async function testWithCurrentSettings(model: SavedModel, keyId: string): Promise<void> {
  try {
    await testModel({
      type: model.type,
      provider: model.provider,
      keyId: model.provider === FORGE_PROVIDER ? undefined : keyId,
      address: model.address ?? undefined,
      modelId: model.modelId,
    });
    showToast(
      'success',
      getText('PlatformInfrastructure.models.testSucceeded', { name: model.displayName }),
    );
  } catch (thrown) {
    showError(toPlatformError(thrown, MODULE_NAME, 'testModel'));
  }
}

/** 刪除模型：危險操作的確認視窗，提醒其他模組正在使用的設定會失效；確認後刪除並提示。 */
async function confirmAndDelete(model: SavedModel, editor: ModelKeyEditor): Promise<void> {
  const isConfirmed = await showConfirm({
    title: getText('PlatformInfrastructure.models.deleteTitle'),
    message: getText('PlatformInfrastructure.models.deleteMessage', { name: model.displayName }),
    confirmLabel: getText('PlatformInfrastructure.models.deleteConfirm'),
    isDanger: true,
  });
  if (!isConfirmed) return;
  try {
    await deleteModel(model.id);
    editor.removeModel(model.id);
    showToast(
      'success',
      getText('PlatformInfrastructure.models.deleted', { name: model.displayName }),
    );
  } catch (thrown) {
    showError(toPlatformError(thrown, MODULE_NAME, 'deleteModel'));
  }
}

// ===== 送出 =====

/** 依序送出每一列換的 key；每一列各自成功或失敗，互不影響。 */
async function sendKeyChanges(
  models: SavedModel[],
  keyDrafts: Record<string, string>,
): Promise<Map<string, KeySaveResult>> {
  const results = new Map<string, KeySaveResult>();
  for (const model of models) {
    try {
      results.set(model.id, { model: await updateModelKey(model.id, keyDrafts[model.id]) });
    } catch (thrown) {
      results.set(model.id, { error: toPlatformError(thrown, MODULE_NAME, 'updateModelKey') });
    }
  }
  return results;
}

/** 全部成功為「已儲存」；有成功也有失敗（含沒選 key 的列）為「部分儲存失敗」；全部失敗為「儲存失敗」。 */
function describeSaveOutcome(
  results: Map<string, KeySaveResult>,
  hasSkippedRows: boolean,
): SaveFeedback {
  const values = [...results.values()];
  const succeeded = values.filter((result) => 'model' in result).length;
  if (succeeded === values.length && !hasSkippedRows) {
    return { text: getText('PlatformInfrastructure.models.saved'), tone: 'success' };
  }
  if (succeeded > 0) {
    return { text: getText('PlatformInfrastructure.models.partiallyFailed'), tone: 'danger' };
  }
  return { text: getText('PlatformInfrastructure.common.saveFailed'), tone: 'danger' };
}

interface SaveResultSetters {
  onModelsChange: ModelPanelProps['onModelsChange'];
  setKeyDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setRowErrors: Dispatch<SetStateAction<Record<string, string>>>;
}

/** 成功的列換成存好的模型、拿掉修改；失敗的列保留選的 key，顯示白話說明。 */
function applySaveResults(results: Map<string, KeySaveResult>, setters: SaveResultSetters) {
  const saved = new Map<string, SavedModel>();
  const errors: Record<string, string> = {};
  for (const [modelId, result] of results) {
    if ('model' in result) saved.set(modelId, result.model);
    else errors[modelId] = getText(`errors.${result.error.code}`);
  }
  setters.onModelsChange((current) => current.map((model) => saved.get(model.id) ?? model));
  setters.setKeyDrafts((current) => omitKeys(current, [...saved.keys()]));
  setters.setRowErrors((current) => ({ ...omitKeys(current, [...saved.keys()]), ...errors }));
}

/** 新增模型後重新載入列表；失敗時顯示錯誤，列表維持原樣。 */
async function reloadModels(onModelsChange: ModelPanelProps['onModelsChange']): Promise<void> {
  try {
    const models = await listModels();
    onModelsChange(() => models);
  } catch (thrown) {
    showError(toPlatformError(thrown, MODULE_NAME, 'listModels'));
  }
}

// ===== 輔助 =====

/** key 為空時的提示：存下的 key 已被刪除、而且還沒改過，是「被刪除」；自己選回未選是「請選擇 key」。 */
function describeMissingKey(model: SavedModel, editor: ModelKeyEditor): string {
  if (editor.selectedKeyOf(model) !== '') return '';
  if (model.keyId === null && !(model.id in editor.keyDrafts)) {
    return getText('PlatformInfrastructure.models.keyDeleted');
  }
  return getText('PlatformInfrastructure.models.keyRequired');
}

/** 設定或移除一筆（value 為 null 時移除）。 */
function withDraft(drafts: Record<string, string>, id: string, value: string | null) {
  if (value === null) return omitKeys(drafts, [id]);
  return { ...drafts, [id]: value };
}

function omitKeys(drafts: Record<string, string>, ids: string[]): Record<string, string> {
  const result = { ...drafts };
  for (const id of ids) delete result[id];
  return result;
}
