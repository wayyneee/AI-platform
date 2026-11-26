// 新增模型視窗四步的內容：1. 供應商、2. 連線（key 或 Forge 位址）、3. 模型（偵測結果與資訊卡）、4. 名稱與價格。

import {
  FORGE_DEFAULT_ADDRESS,
  MODEL_TYPE_PROVIDERS,
  type ApiKeySummary,
  type DetectedModel,
  type ModelType,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { Badge, Button, Select, TextInput } from '../SharedComponents/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import {
  findChosenModel,
  isPriceInvalid,
  listPriceFields,
  type AddModelForm,
  type PriceField,
  type StepName,
} from './addModelForm.ts';
import { listCapabilityItems, listMediaItems, summarizeModel } from './modelDisplay.ts';
import type { AddModelDialogState } from './useAddModelDialog.ts';

const FORGE_PROVIDER = 'forge';

// ===== 每一步的內容 =====

interface StepControlProps {
  step: StepName;
  type: ModelType;
  savedKeys: ApiKeySummary[];
  dialog: AddModelDialogState;
}

export function StepControl({ step, type, savedKeys, dialog }: StepControlProps) {
  if (step === 'provider') return <ProviderStep type={type} dialog={dialog} />;
  if (step === 'connection') return <ConnectionStep savedKeys={savedKeys} dialog={dialog} />;
  if (step === 'model') return <ModelStep dialog={dialog} />;
  return <DetailsStep type={type} dialog={dialog} />;
}

/** 1. 供應商：只列支援這個類型的供應商。 */
function ProviderStep({ type, dialog }: { type: ModelType; dialog: AddModelDialogState }) {
  return (
    <Select
      value={dialog.form.provider}
      options={MODEL_TYPE_PROVIDERS[type].map((provider) => ({
        value: provider,
        label: getText(`PlatformInfrastructure.provider.${provider}`),
      }))}
      onChange={dialog.selectProvider}
      hasPlaceholder
      ariaLabel={getText('PlatformInfrastructure.addModel.stepProvider')}
      searchPlaceholder={getText('PlatformInfrastructure.addModel.searchProvider')}
    />
  );
}

/** 2. 連線：雲端供應商選已儲存的 key（沒有時提示）；Forge 填位址並按「偵測」。 */
function ConnectionStep({
  savedKeys,
  dialog,
}: {
  savedKeys: ApiKeySummary[];
  dialog: AddModelDialogState;
}) {
  if (dialog.form.provider === FORGE_PROVIDER) return <ForgeConnection dialog={dialog} />;
  const { form } = dialog;
  const keys = savedKeys.filter((key) => key.provider === form.provider);
  if (keys.length === 0) {
    return (
      <div className="platform-infrastructure-row-error">
        {getText('PlatformInfrastructure.addModel.noKey')}
      </div>
    );
  }
  return (
    <>
      <Select
        value={form.keyId}
        options={keys.map((key) => ({ value: key.id, label: key.name, hint: key.maskedKey }))}
        onChange={dialog.selectKey}
        hasPlaceholder
        ariaLabel={getText('PlatformInfrastructure.addModel.stepConnection')}
      />
      <DetectError form={form} />
    </>
  );
}

/** Forge：填位址並按「偵測」，沒有啟動時位址下方提示。 */
function ForgeConnection({ dialog }: { dialog: AddModelDialogState }) {
  const { form } = dialog;
  return (
    <>
      <div className="platform-infrastructure-add-model-inline">
        <TextInput
          value={form.address}
          onChange={dialog.changeAddress}
          placeholder={FORGE_DEFAULT_ADDRESS}
          ariaLabel={getText('PlatformInfrastructure.addModel.forgeAddress')}
        />
        <Button
          variant="secondary"
          isDisabled={!form.address.trim() || form.detect.status === 'loading'}
          onClick={dialog.detectForge}
        >
          {getText('PlatformInfrastructure.addModel.detect')}
        </Button>
      </div>
      <DetectError form={form} />
      <div className="platform-infrastructure-hint">
        {getText('PlatformInfrastructure.addModel.forgeAddressHint')}
      </div>
    </>
  );
}

function DetectError({ form }: { form: AddModelForm }) {
  if (form.detect.status !== 'failed') return null;
  return <div className="platform-infrastructure-row-error">{form.detect.errorText}</div>;
}

/** 3. 模型：偵測中顯示讀取中；選項的提示小字為能力摘要；選好後顯示模型資訊卡。 */
function ModelStep({ dialog }: { dialog: AddModelDialogState }) {
  const { form } = dialog;
  if (form.detect.status === 'loading') {
    return (
      <div className="platform-infrastructure-add-model-detecting">
        <span className="platform-infrastructure-spinner" />
        {getText('PlatformInfrastructure.addModel.detecting')}
      </div>
    );
  }
  if (form.detect.status !== 'done') {
    return (
      <div className="platform-infrastructure-hint">
        {getText('PlatformInfrastructure.addModel.connectFirst')}
      </div>
    );
  }
  const models = form.detect.models;
  const chosen = findChosenModel(form);
  return (
    <>
      <Select
        value={form.modelId}
        options={models.map((model) => ({
          value: model.id,
          label: model.displayName,
          hint: summarizeModel(model),
        }))}
        onChange={(modelId) => dialog.selectModel(models.find((model) => model.id === modelId))}
        hasPlaceholder
        ariaLabel={getText('PlatformInfrastructure.addModel.stepModel')}
        searchPlaceholder={getText('PlatformInfrastructure.addModel.searchModel')}
      />
      <div className="platform-infrastructure-hint">
        {getText('PlatformInfrastructure.addModel.detectedCount', { count: models.length })}
      </div>
      {chosen && <ModelInfoCard model={chosen} />}
    </>
  );
}

/** 模型資訊卡：LLM 列出七項能力（未知用警告樣式）；其他類型列出可輸入、可輸出。 */
function ModelInfoCard({ model }: { model: DetectedModel }) {
  const items = model.capabilities
    ? listCapabilityItems(model.capabilities)
    : listMediaItems(model);
  const hasUnknown = items.some((item) => item.support === 'unknown');
  return (
    <div className="platform-infrastructure-add-model-info">
      {model.description && (
        <p className="platform-infrastructure-add-model-info-description">{model.description}</p>
      )}
      <dl className="platform-infrastructure-add-model-info-list">
        {items.map((item) => (
          <div key={item.label} className={item.support ? `is-${item.support}` : undefined}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {hasUnknown && (
        <div className="platform-infrastructure-add-model-info-note">
          {getText('PlatformInfrastructure.addModel.unknownNote')}
        </div>
      )}
    </div>
  );
}

/** 4. 名稱與價格：Forge 不顯示價格欄，改為「本機執行，不計費」。 */
function DetailsStep({ type, dialog }: { type: ModelType; dialog: AddModelDialogState }) {
  const { form } = dialog;
  const fields = listPriceFields(type, form);
  return (
    <>
      <label className="platform-infrastructure-add-model-label">
        {getText('PlatformInfrastructure.addModel.displayName')}
      </label>
      <TextInput
        value={form.displayName}
        onChange={dialog.changeName}
        isInvalid={!form.displayName.trim()}
        ariaLabel={getText('PlatformInfrastructure.addModel.displayName')}
      />
      {form.provider === FORGE_PROVIDER ? (
        <div className="platform-infrastructure-hint">
          {getText('PlatformInfrastructure.models.forgeFree')}
        </div>
      ) : (
        <>
          <div className="platform-infrastructure-add-model-prices">
            {fields.map((field) => (
              <PriceInput key={field} field={field} type={type} dialog={dialog} />
            ))}
          </div>
          <div className="platform-infrastructure-hint">
            {getText('PlatformInfrastructure.addModel.priceHint')}
          </div>
        </>
      )}
    </>
  );
}

interface PriceInputProps {
  field: PriceField;
  type: ModelType;
  dialog: AddModelDialogState;
}

/** 一個價格欄位：自動帶入的標示「已自動帶入」（改過就拿掉），負數時紅框並提示。 */
function PriceInput({ field, type, dialog }: PriceInputProps) {
  const { form } = dialog;
  const value = form.prices[field] ?? '';
  const label = priceLabel(field, type);
  const isAuto = form.autoPrices[field] !== undefined && form.autoPrices[field] === value;
  const isInvalid = isPriceInvalid(value);
  return (
    <div>
      <label className="platform-infrastructure-add-model-label">
        {label}
        {isAuto && (
          <Badge tone="success">{getText('PlatformInfrastructure.addModel.priceAuto')}</Badge>
        )}
      </label>
      <div className="platform-infrastructure-add-model-money">
        <span className="platform-infrastructure-add-model-money-sign">$</span>
        <TextInput
          type="number"
          value={value}
          onChange={(text) => dialog.changePrice(field, text)}
          placeholder={getText('PlatformInfrastructure.addModel.pricePlaceholder')}
          isInvalid={isInvalid}
          ariaLabel={label}
        />
      </div>
      {isInvalid && (
        <div className="platform-infrastructure-field-error">
          {getText('PlatformInfrastructure.addModel.priceNegative')}
        </div>
      )}
    </div>
  );
}

function priceLabel(field: PriceField, type: ModelType): string {
  if (field === 'inputPerMillionTokens')
    return getText('PlatformInfrastructure.addModel.priceInput');
  if (field === 'outputPerMillionTokens') {
    return getText('PlatformInfrastructure.addModel.priceOutput');
  }
  if (field === 'perSearch') return getText('PlatformInfrastructure.addModel.priceSearch');
  return getText(`PlatformInfrastructure.addModel.priceUnit.${type}`);
}
