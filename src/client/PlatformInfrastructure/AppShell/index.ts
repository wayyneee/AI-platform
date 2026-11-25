// AppShell 的唯一入口：模組登記、外殼的啟動、未儲存離開確認。

export { registerModule } from './moduleRegistry.ts';
export type { ModuleRegistration, PageRegistration } from './moduleRegistry.ts';
export { startAppShell } from './startAppShell.tsx';
export { useLeaveGuard } from './leaveGuard.ts';
