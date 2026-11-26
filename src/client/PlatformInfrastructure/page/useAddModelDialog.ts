// 新增模型視窗的表單狀態與操作：選供應商、key 或位址、模型，偵測、測試、儲存。
// 每次改了供應商、連線或模型，版本號就加一；等待中的偵測、測試結果回來時版本不同就丟掉，不覆蓋新的選擇。

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { DetectedModel, ModelType } from '../../../shared/PlatformInfrastructure/types.ts';
import { addModel, detectModels, testModel } from '../ModelRegistry/index.ts';
import { showError, showToast, type ModalControls } from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import {
  buildConnection,
  buildNewModel,
  changeAddress,
  chooseKey,
  chooseModel,
  chooseProvider,
  createEmptyForm,
  isFormDirty,
  startDetecting,
  type AddModelForm,
  type PriceField,
} from './addModelForm.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 視窗各部分拿到的表單狀態與操作。 */
export type AddModelDialogState = ReturnType<typeof useAddModelDialog>;

/** 非同步的步驟回來時要用的：目前的版本號、更新表單。 */
interface FormAccess {
  version: MutableRefObject<number>;
  setForm: Dispatch<SetStateAction<AddModelForm>>;
}

// ===== 主要流程 =====

/** 新增模型視窗的狀態；有修改時告訴視窗，關閉前會先詢問。 */
export function useAddModelDialog(type: ModelType, controls: ModalControls, onSaved: () => void) {
  const [form, setForm] = useState<AddModelForm>(createEmptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const version = useRef(0);
  const access: FormAccess = { version, setForm };

  useEffect(() => controls.setHasUnsavedChanges(isFormDirty(form)), [controls, form]);

  /** 改了會讓等待中的結果過時的欄位：版本號加一。 */
  const update = (next: AddModelForm) => {
    version.current += 1;
    setForm(next);
  };

  const detect = (base: AddModelForm) => {
    update(startDetecting(base));
    void runDetection(type, base, access);
  };

  return {
    form,
    isSaving,
    selectProvider: (provider: string) =>
      update(chooseProvider(provider as AddModelForm['provider'])),
    // 選好 key 就偵測；選回未選只清空後面的步驟
    selectKey: (keyId: string) =>
      keyId ? detect(chooseKey(form, keyId)) : update(chooseKey(form, keyId)),
    changeAddress: (address: string) => update(changeAddress(form, address)),
    detectForge: () => detect(form),
    selectModel: (model: DetectedModel | undefined) => update(chooseModel(form, model)),
    changeName: (displayName: string) => setForm((current) => ({ ...current, displayName })),
    changePrice: (field: PriceField, text: string) =>
      setForm((current) => ({ ...current, prices: { ...current.prices, [field]: text } })),
    runTest: () => void runModelTest(type, form, access),
    save: () => void saveModel(type, form, { controls, onSaved, setIsSaving }),
  };
}

// ===== 偵測 =====

/** 偵測模型；失敗時把白話說明直接寫在連線下方，不另外跳錯誤訊息（同一件事只提示一次）。 */
async function runDetection(type: ModelType, base: AddModelForm, access: FormAccess) {
  const detectVersion = access.version.current;
  try {
    const models = await detectModels(buildConnection(type, base));
    if (detectVersion !== access.version.current) return;
    access.setForm((current) => ({ ...current, detect: { status: 'done', models } }));
  } catch (thrown) {
    if (detectVersion !== access.version.current) return;
    const error = toPlatformError(thrown, MODULE_NAME, 'detectModels');
    const errorText = getText(`errors.${error.code}`);
    access.setForm((current) => ({ ...current, detect: { status: 'failed', errorText } }));
  }
}

// ===== 測試 =====

/** 用目前的設定測試；成功後才能儲存，失敗時顯示錯誤。 */
async function runModelTest(type: ModelType, form: AddModelForm, access: FormAccess) {
  const testVersion = access.version.current;
  access.setForm((current) => ({ ...current, test: 'running' }));
  try {
    await testModel({ ...buildConnection(type, form), modelId: form.modelId });
    if (testVersion !== access.version.current) return;
    access.setForm((current) => ({ ...current, test: 'success' }));
  } catch (thrown) {
    if (testVersion !== access.version.current) return;
    access.setForm((current) => ({ ...current, test: 'failed' }));
    showError(toPlatformError(thrown, MODULE_NAME, 'testModel'));
  }
}

// ===== 儲存 =====

interface SaveContext {
  controls: ModalControls;
  onSaved: () => void;
  setIsSaving: (isSaving: boolean) => void;
}

/** 儲存成功後直接關閉視窗（不詢問）並提示；失敗時視窗留著，顯示錯誤。 */
async function saveModel(type: ModelType, form: AddModelForm, context: SaveContext) {
  context.setIsSaving(true);
  try {
    const saved = await addModel(buildNewModel(type, form));
    context.controls.close();
    showToast(
      'success',
      getText('PlatformInfrastructure.addModel.added', { name: saved.displayName }),
    );
    context.onSaved();
  } catch (thrown) {
    context.setIsSaving(false);
    showError(toPlatformError(thrown, MODULE_NAME, 'addModel'));
  }
}
