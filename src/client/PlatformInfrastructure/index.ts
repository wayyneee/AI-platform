// PlatformInfrastructure 前端的唯一入口：其他核心模組和前端進入點只透過這裡使用平台基礎。

export type {
  LlmCapabilities,
  LogEntry,
  LogInput,
  LogLevel,
  ModelType,
  ParamDefinition,
  PlatformError,
  PlatformSettings,
  SavedModel,
} from '../../shared/PlatformInfrastructure/types.ts';
export { registerModule, startAppShell, useLeaveGuard } from './AppShell/index.ts';
export type { ModuleRegistration, PageRegistration } from './AppShell/index.ts';
export { getModelParams, listModels } from './ModelRegistry/index.ts';
export { getModuleRegistration } from './page/moduleRegistration.ts';
export {
  closeAllModals,
  showConfirm,
  showError,
  showModal,
  showToast,
  useSharedComponents,
} from './SharedComponents/index.ts';
export type {
  ConfirmOptions,
  ModalControls,
  ModalHandle,
  ModalOptions,
  ToastType,
} from './SharedComponents/index.ts';
export { createError, defineErrorCodes, isPlatformError, writeLog } from './SystemLog/index.ts';
export { getAssetUrl, getSettings, getText, registerTextTable } from './ThemeAndLanguage/index.ts';
