// SharedComponents 的唯一入口：全平台共用的基本元件與回饋類元件，以及它們的樣式。

import './sharedComponents.css';

import { Badge, Button, Tabs } from './basicControls.tsx';
import { EmptyState, ErrorMessage, LoadingState } from './feedback.tsx';
import { Select } from './Select.tsx';

export { Badge, Button, joinClassNames, Tabs } from './basicControls.tsx';
export type {
  BadgeProps,
  BadgeTone,
  ButtonProps,
  ButtonVariant,
  TabItem,
  TabsProps,
} from './basicControls.tsx';
export { describeErrorSource, EmptyState, ErrorMessage, LoadingState } from './feedback.tsx';
export type { EmptyStateProps, ErrorMessageProps, LoadingStateProps } from './feedback.tsx';
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
};

/** 取得共用元件的集合，給其他模組組自己的畫面。 */
export function useSharedComponents(): typeof sharedComponents {
  return sharedComponents;
}
