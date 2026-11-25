// SharedComponents 的唯一入口：全平台共用的基本元件、視窗類、回饋類元件，以及它們的樣式。

import './sharedComponents.css';

import { Badge, Button, Tabs, TextInput, Toggle } from './basicControls.tsx';
import { EmptyState, ErrorMessage, LoadingState, TaskProgress } from './feedback.tsx';
import { Select } from './Select.tsx';

export { Badge, Button, joinClassNames, Tabs, TextInput, Toggle } from './basicControls.tsx';
export type {
  BadgeProps,
  BadgeTone,
  ButtonProps,
  ButtonVariant,
  TabItem,
  TabsProps,
  TextInputProps,
  TextInputType,
  ToggleProps,
} from './basicControls.tsx';
export {
  describeErrorSource,
  EmptyState,
  ErrorMessage,
  LoadingState,
  TaskProgress,
} from './feedback.tsx';
export type {
  EmptyStateProps,
  ErrorMessageProps,
  LoadingStateProps,
  TaskProgressProps,
  TaskProgressStatus,
} from './feedback.tsx';
export {
  closeAllModals,
  confirmDiscardChanges,
  hasUnsavedModal,
  showConfirm,
  showModal,
} from './modals.tsx';
export type { ConfirmOptions, ModalControls, ModalHandle, ModalOptions } from './modals.tsx';
export { NOTICE_LIMIT, showError, showToast, TOAST_DURATIONS_MS } from './notices.tsx';
export type { ToastType } from './notices.tsx';
export { OverlayHost } from './OverlayHost.tsx';
export { Select } from './Select.tsx';
export type { SelectOption, SelectProps } from './Select.tsx';

const sharedComponents = {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  LoadingState,
  Select,
  Tabs,
  TaskProgress,
  TextInput,
  Toggle,
};

/** 取得共用元件的集合，給其他模組組自己的畫面。 */
export function useSharedComponents(): typeof sharedComponents {
  return sharedComponents;
}
