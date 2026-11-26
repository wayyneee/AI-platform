// 新增模型視窗（AddModelDialog）：頂部插圖與類型標籤 → 四步表單 → 底部「測試」「儲存」。
// 前一步完成後下一步才能操作；測試成功後才能儲存，儲存成功直接關閉並提示。有修改時按 X、Esc 或換頁先詢問。

import type { ReactNode } from 'react';

import type { ApiKeySummary, ModelType } from '../../../shared/PlatformInfrastructure/types.ts';
import {
  Badge,
  Button,
  joinClassNames,
  showModal,
  type ModalControls,
} from '../SharedComponents/index.ts';
import { getAssetUrl, getText } from '../ThemeAndLanguage/index.ts';
import {
  canSave,
  isStepDone,
  isStepEnabled,
  type AddModelForm,
  type StepName,
} from './addModelForm.ts';
import { StepControl } from './AddModelSteps.tsx';
import { useAddModelDialog, type AddModelDialogState } from './useAddModelDialog.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const STEPS: StepName[] = ['provider', 'connection', 'model', 'details'];
const STEP_TITLE_KEYS: Record<StepName, string> = {
  provider: 'PlatformInfrastructure.addModel.stepProvider',
  connection: 'PlatformInfrastructure.addModel.stepConnection',
  model: 'PlatformInfrastructure.addModel.stepModel',
  details: 'PlatformInfrastructure.addModel.stepDetails',
};
const DISABLED_HINT_KEYS: Partial<Record<StepName, string>> = {
  connection: 'PlatformInfrastructure.addModel.connectionDisabled',
  model: 'PlatformInfrastructure.addModel.modelDisabled',
  details: 'PlatformInfrastructure.addModel.detailsDisabled',
};

export interface AddModelDialogOptions {
  type: ModelType;
  savedKeys: ApiKeySummary[];
  /** 儲存成功、視窗關閉後呼叫，例如重新載入模型列表 */
  onSaved: () => void;
}

// ===== 開啟 =====

/** 打開新增模型視窗。 */
export function openAddModelDialog(options: AddModelDialogOptions): void {
  showModal({
    title: getText('PlatformInfrastructure.addModel.title'),
    className: 'platform-infrastructure-add-model',
    hasCustomFrame: true,
    content: (controls) => <AddModelDialog {...options} controls={controls} />,
  });
}

// ===== 視窗 =====

interface AddModelDialogProps extends AddModelDialogOptions {
  controls: ModalControls;
}

function AddModelDialog({ type, savedKeys, onSaved, controls }: AddModelDialogProps) {
  const dialog = useAddModelDialog(type, controls, onSaved);
  return (
    <>
      <DialogHeader type={type} controls={controls} />
      <div className="platform-infrastructure-add-model-body">
        {STEPS.map((step, index) => (
          <Step key={step} step={step} number={index + 1} form={dialog.form}>
            <StepControl step={step} type={type} savedKeys={savedKeys} dialog={dialog} />
          </Step>
        ))}
      </div>
      <DialogFooter type={type} dialog={dialog} />
    </>
  );
}

// ===== 標題列、步驟外框、底部 =====

function DialogHeader({ type, controls }: { type: ModelType; controls: ModalControls }) {
  return (
    <div className="platform-infrastructure-add-model-header">
      <img
        className="platform-infrastructure-add-model-character"
        src={getAssetUrl(MODULE_NAME, 'addModelHeader')}
        alt=""
      />
      <div className="platform-infrastructure-add-model-heading">
        <span className="platform-infrastructure-eyebrow">
          {getText('PlatformInfrastructure.addModel.eyebrow')}
        </span>
        <h2 className="platform-infrastructure-modal-title" id={controls.titleId}>
          {getText('PlatformInfrastructure.addModel.title')}
          <Badge tone="accent">{getText(`PlatformInfrastructure.modelType.${type}`)}</Badge>
        </h2>
        <span className="platform-infrastructure-hint">
          {getText('PlatformInfrastructure.addModel.hint')}
        </span>
      </div>
      <button
        type="button"
        className="platform-infrastructure-icon-button platform-infrastructure-add-model-close"
        aria-label={getText('PlatformInfrastructure.common.close')}
        onClick={controls.requestClose}
      >
        ×
      </button>
    </div>
  );
}

interface StepProps {
  step: StepName;
  number: number;
  form: AddModelForm;
  children: ReactNode;
}

/** 一步：編號、標題、內容；還不能操作時變淡並顯示提示。 */
function Step({ step, number, form, children }: StepProps) {
  const isEnabled = isStepEnabled(form, step);
  const disabledHint = DISABLED_HINT_KEYS[step];
  return (
    <section
      className={joinClassNames(
        'platform-infrastructure-add-model-step',
        !isEnabled && 'is-disabled',
        isStepDone(form, step) && 'is-done',
      )}
    >
      <span className="platform-infrastructure-add-model-step-number">{number}</span>
      <div>
        <div className="platform-infrastructure-add-model-step-title">
          {getText(STEP_TITLE_KEYS[step])}
        </div>
        <div data-step-control>
          {isEnabled || !disabledHint ? (
            children
          ) : (
            <div className="platform-infrastructure-hint">{getText(disabledHint)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

/** 底部：測試結果小字在按鈕左邊；測試要先選模型，儲存要測試成功、名稱有填、價格沒有錯。 */
function DialogFooter({ type, dialog }: { type: ModelType; dialog: AddModelDialogState }) {
  const { form, isSaving } = dialog;
  const feedback = {
    success: { className: 'is-success', key: 'PlatformInfrastructure.addModel.testSucceeded' },
    failed: { className: 'is-danger', key: 'PlatformInfrastructure.addModel.testFailed' },
  }[form.test as 'success' | 'failed'];
  return (
    <div className="platform-infrastructure-add-model-footer">
      <span
        className={joinClassNames('platform-infrastructure-feedback', feedback?.className)}
        role="status"
      >
        {feedback && getText(feedback.key)}
      </span>
      <Button
        variant="secondary"
        isDisabled={!form.modelId || isSaving}
        isBusy={form.test === 'running'}
        busyLabel={getText('PlatformInfrastructure.addModel.testing')}
        onClick={dialog.runTest}
      >
        {getText('PlatformInfrastructure.addModel.test')}
      </Button>
      <Button
        isDisabled={!canSave(type, form)}
        isBusy={isSaving}
        busyLabel={getText('PlatformInfrastructure.common.saving')}
        onClick={dialog.save}
      >
        {getText('PlatformInfrastructure.common.save')}
      </Button>
    </div>
  );
}
