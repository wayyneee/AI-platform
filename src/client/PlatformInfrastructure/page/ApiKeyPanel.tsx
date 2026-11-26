// API 串接的「API key」分頁：新增、改名、換 key、刪除；按儲存時先檢查必填，再依序新增、修改，
// 成功的照存、失敗的列保留紅框和輸入內容。完整的 key 只在送出時用到，畫面上只顯示遮罩值。

import { useEffect, useState } from 'react';

import {
  PROVIDERS_REQUIRING_KEY,
  type ApiKeySummary,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { useLeaveGuard } from '../AppShell/index.ts';
import { addApiKey, deleteApiKey, updateApiKey } from '../ModelRegistry/index.ts';
import {
  Button,
  EmptyState,
  joinClassNames,
  Select,
  showConfirm,
  showError,
  showToast,
  TextInput,
} from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import {
  applySaveResult,
  changeRowField,
  checkRequiredFields,
  createNewRow,
  createSavedRow,
  isRowChanged,
  mergeSavedKeys,
  type KeyField,
  type KeyRow,
  type RowSaveResult,
} from './apiKeyRows.ts';
import { SaveBar, type SaveFeedback } from './settingsPageParts.tsx';

const MODULE_NAME = 'PlatformInfrastructure';

interface ApiKeyPanelProps {
  savedKeys: ApiKeySummary[];
  /** 儲存或刪除成功後更新頁面保存的 key 清單（切換分頁回來時用它重建列表） */
  onSavedKeysChange: (update: (keys: ApiKeySummary[]) => ApiKeySummary[]) => void;
  /** 回報有沒有未儲存的修改，讓頁面在切換分頁前詢問 */
  onDirtyChange: (isDirty: boolean) => void;
}

// ===== 分頁 =====

/** API key 分頁：key 列表（或空狀態）和儲存列。 */
export function ApiKeyPanel({ savedKeys, onSavedKeysChange, onDirtyChange }: ApiKeyPanelProps) {
  const editor = useKeyRowsEditor(savedKeys, onSavedKeysChange);
  useLeaveGuard(editor.isDirty);
  useEffect(() => onDirtyChange(editor.isDirty), [editor.isDirty, onDirtyChange]);

  return (
    <>
      <section className="platform-infrastructure-card">
        <KeyCardHeader hasRows={editor.rows.length > 0} onAdd={editor.addRow} />
        {editor.rows.length === 0 ? (
          <NoKeys onAdd={editor.addRow} />
        ) : (
          <KeyTable rows={editor.rows} onChange={editor.changeField} onRemove={editor.removeRow} />
        )}
      </section>
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

/** 列表的編輯狀態與操作：新增列、改欄位、刪除、儲存。 */
function useKeyRowsEditor(
  savedKeys: ApiKeySummary[],
  onSavedKeysChange: ApiKeyPanelProps['onSavedKeysChange'],
) {
  const [rows, setRows] = useState<KeyRow[]>(() => savedKeys.map(createSavedRow));
  const [feedback, setFeedback] = useState<SaveFeedback>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 新的列加在最上方（page.md）
  const addRow = () => {
    setRows((current) => [createNewRow(), ...current]);
    setFeedback(null);
  };

  const changeField = (rowId: string, field: KeyField, value: string) => {
    setRows((current) =>
      current.map((row) => (row.rowId === rowId ? changeRowField(row, field, value) : row)),
    );
    setFeedback(null);
  };

  const removeRow = async (row: KeyRow) => {
    // 還沒儲存的新列直接移除；已儲存的要確認後才刪
    if (row.saved && !(await confirmAndDelete(row.saved))) return;
    setRows((current) => current.filter((item) => item.rowId !== row.rowId));
    // 列表變了，上一次儲存的結果小字已經不準
    setFeedback(null);
    if (row.saved) onSavedKeysChange((keys) => keys.filter((key) => key.id !== row.saved?.id));
  };

  const save = async () => {
    const checked = rows.map((row) => (isRowChanged(row) ? checkRequiredFields(row) : row));
    setRows(checked);
    const rowsToSend = checked.filter((row) => isRowChanged(row) && row.invalidFields.length === 0);
    if (rowsToSend.length === 0) {
      setFeedback({ text: getText('PlatformInfrastructure.apiKeys.fixRequired'), tone: 'danger' });
      return;
    }
    setIsSaving(true);
    const results = await sendRowChanges(rowsToSend);
    setIsSaving(false);
    setRows((current) => current.map((row) => applySaveResult(row, results.get(row.rowId))));
    onSavedKeysChange((keys) => mergeSavedKeys(keys, results));
    setFeedback(describeSaveOutcome(results, rowsToSend.length < countChanged(checked)));
  };

  const isDirty = rows.some(isRowChanged);
  return { rows, feedback, isSaving, isDirty, addRow, changeField, removeRow, save };
}

// ===== 表格 =====

function KeyCardHeader({ hasRows, onAdd }: { hasRows: boolean; onAdd: () => void }) {
  return (
    <div className="platform-infrastructure-card-header">
      <h2 className="platform-infrastructure-card-title">
        {getText('PlatformInfrastructure.apiKeys.cardTitle')}
        <span className="platform-infrastructure-eyebrow">
          {getText('PlatformInfrastructure.apiKeys.cardEyebrow')}
        </span>
      </h2>
      <span className="platform-infrastructure-card-header-spacer" />
      {/* 空狀態裡已經有新增按鈕，標題列就不重複放 */}
      {hasRows && (
        <Button variant="secondary" isSmall onClick={onAdd}>
          {getText('PlatformInfrastructure.apiKeys.add')}
        </Button>
      )}
    </div>
  );
}

function NoKeys({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState text={getText('PlatformInfrastructure.apiKeys.empty')}>
      <div className="platform-infrastructure-hint">
        {getText('PlatformInfrastructure.apiKeys.emptyHint')}
      </div>
      <Button onClick={onAdd}>{getText('PlatformInfrastructure.apiKeys.add')}</Button>
    </EmptyState>
  );
}

interface KeyTableProps {
  rows: KeyRow[];
  onChange: (rowId: string, field: KeyField, value: string) => void;
  onRemove: (row: KeyRow) => void;
}

function KeyTable({ rows, onChange, onRemove }: KeyTableProps) {
  return (
    <div>
      <div className="platform-infrastructure-key-table-head">
        <span>{getText('PlatformInfrastructure.apiKeys.columnProvider')}</span>
        <span>{getText('PlatformInfrastructure.apiKeys.columnName')}</span>
        <span>{getText('PlatformInfrastructure.apiKeys.columnKey')}</span>
        <span />
      </div>
      {rows.map((row) => (
        <KeyRowItem
          key={row.rowId}
          row={row}
          onChange={(field, value) => onChange(row.rowId, field, value)}
          onRemove={() => onRemove(row)}
        />
      ))}
    </div>
  );
}

interface KeyRowItemProps {
  row: KeyRow;
  onChange: (field: KeyField, value: string) => void;
  onRemove: () => void;
}

/** 一列：供應商（新列可選、已儲存只顯示文字）、名稱、key（密碼框，提示文字為遮罩值）、刪除。 */
function KeyRowItem({ row, onChange, onRemove }: KeyRowItemProps) {
  const isInvalid = (field: KeyField) => row.invalidFields.includes(field);
  const keyPlaceholder = row.saved
    ? getText('PlatformInfrastructure.apiKeys.keyPlaceholderSaved', {
        maskedKey: row.saved.maskedKey,
      })
    : getText('PlatformInfrastructure.apiKeys.keyPlaceholderNew');
  return (
    <div className={joinClassNames('platform-infrastructure-key-item', !row.saved && 'is-new')}>
      <div className="platform-infrastructure-key-row">
        <ProviderCell row={row} isInvalid={isInvalid('provider')} onChange={onChange} />
        <TextInput
          value={row.name}
          onChange={(value) => onChange('name', value)}
          placeholder={getText('PlatformInfrastructure.apiKeys.namePlaceholder')}
          isInvalid={isInvalid('name')}
          ariaLabel={getText('PlatformInfrastructure.apiKeys.columnName')}
        />
        <TextInput
          type="password"
          value={row.keyValue}
          onChange={(value) => onChange('keyValue', value)}
          placeholder={keyPlaceholder}
          isInvalid={isInvalid('keyValue')}
          ariaLabel={getText('PlatformInfrastructure.apiKeys.columnKey')}
        />
        <span className="platform-infrastructure-key-delete">
          <Button variant="subtleDanger" isSmall onClick={onRemove}>
            {getText('PlatformInfrastructure.apiKeys.delete')}
          </Button>
        </span>
      </div>
      {row.errorText && <div className="platform-infrastructure-row-error">{row.errorText}</div>}
    </div>
  );
}

interface ProviderCellProps {
  row: KeyRow;
  isInvalid: boolean;
  onChange: (field: KeyField, value: string) => void;
}

/** 供應商不能改（spec 規則）：已儲存的只顯示文字；新列是可搜尋的選單，只列需要 key 的供應商。 */
function ProviderCell({ row, isInvalid, onChange }: ProviderCellProps) {
  if (row.saved) {
    return (
      <span className="platform-infrastructure-key-provider">
        {getText(`PlatformInfrastructure.provider.${row.saved.provider}`)}
      </span>
    );
  }
  return (
    <Select
      value={row.provider}
      options={PROVIDERS_REQUIRING_KEY.map((provider) => ({
        value: provider,
        label: getText(`PlatformInfrastructure.provider.${provider}`),
      }))}
      onChange={(value) => onChange('provider', value)}
      hasPlaceholder
      isInvalid={isInvalid}
      ariaLabel={getText('PlatformInfrastructure.apiKeys.columnProvider')}
      searchPlaceholder={getText('PlatformInfrastructure.apiKeys.searchProvider')}
    />
  );
}

// ===== 送出 =====

/** 依序送出：先新增、再修改（page.md）；每一列各自成功或失敗，互不影響。 */
async function sendRowChanges(rows: KeyRow[]): Promise<Map<string, RowSaveResult>> {
  const results = new Map<string, RowSaveResult>();
  const ordered = [...rows.filter((row) => !row.saved), ...rows.filter((row) => row.saved)];
  for (const row of ordered) {
    results.set(row.rowId, await sendRow(row));
  }
  return results;
}

async function sendRow(row: KeyRow): Promise<RowSaveResult> {
  try {
    if (!row.saved) {
      // 檢查必填時已確認新列有選供應商
      const provider = row.provider as ApiKeySummary['provider'];
      return { key: await addApiKey({ provider, name: row.name, keyValue: row.keyValue }) };
    }
    const keyValue = row.keyValue === '' ? undefined : row.keyValue;
    return { key: await updateApiKey({ id: row.saved.id, name: row.name, keyValue }) };
  } catch (thrown) {
    const interfaceName = row.saved ? 'updateApiKey' : 'addApiKey';
    return { error: toPlatformError(thrown, MODULE_NAME, interfaceName) };
  }
}

/** 全部成功為「已儲存」；有成功也有失敗（含沒填好的列）為「部分儲存失敗」；全部失敗為「儲存失敗」。 */
function describeSaveOutcome(
  results: Map<string, RowSaveResult>,
  hasSkippedRows: boolean,
): SaveFeedback {
  const values = [...results.values()];
  const succeeded = values.filter((result) => 'key' in result).length;
  if (succeeded === values.length && !hasSkippedRows) {
    return { text: getText('PlatformInfrastructure.apiKeys.saved'), tone: 'success' };
  }
  if (succeeded > 0) {
    return { text: getText('PlatformInfrastructure.apiKeys.partiallyFailed'), tone: 'danger' };
  }
  return { text: getText('PlatformInfrastructure.common.saveFailed'), tone: 'danger' };
}

function countChanged(rows: KeyRow[]): number {
  return rows.filter(isRowChanged).length;
}

// ===== 刪除 =====

/** 刪除已儲存的 key：危險操作的確認視窗，確認後刪除並提示；回傳是否刪除成功。 */
async function confirmAndDelete(key: ApiKeySummary): Promise<boolean> {
  const provider = getText(`PlatformInfrastructure.provider.${key.provider}`);
  const isConfirmed = await showConfirm({
    title: getText('PlatformInfrastructure.apiKeys.deleteTitle'),
    message: getText('PlatformInfrastructure.apiKeys.deleteMessage', { name: key.name, provider }),
    confirmLabel: getText('PlatformInfrastructure.apiKeys.deleteConfirm'),
    isDanger: true,
  });
  if (!isConfirmed) return false;
  try {
    await deleteApiKey(key.id);
    showToast('success', getText('PlatformInfrastructure.apiKeys.deleted', { name: key.name }));
    return true;
  } catch (thrown) {
    showError(toPlatformError(thrown, MODULE_NAME, 'deleteApiKey'));
    return false;
  }
}
