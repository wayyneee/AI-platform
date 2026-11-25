// 內容區的錯誤攔截：頁面畫面出錯時只有內容區顯示錯誤畫面，navbar 和 log 列照常；切換到其他頁面後恢復。

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button, EmptyState } from '../SharedComponents/index.ts';
import { createError, writeLog } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { AppShellErrorCodes } from './globalErrorHandling.ts';

interface ContentErrorBoundaryProps {
  /** 這個頁面所屬的核心模組，寫 log 時標明來源 */
  module: string;
  /** 頁面的網址路徑，寫 log 時標明是哪一頁 */
  pagePath: string;
  children: ReactNode;
}

interface ContentErrorBoundaryState {
  hasError: boolean;
}

/** 包住內容區；外殼用網址路徑當 key，換頁時會重新建立，錯誤畫面就消失。 */
export class ContentErrorBoundary extends Component<
  ContentErrorBoundaryProps,
  ContentErrorBoundaryState
> {
  state: ContentErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ContentErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    const error = createError(
      this.props.module,
      'renderPage',
      AppShellErrorCodes.PLATFORM_PAGE_RENDER_FAILED,
      `頁面 ${this.props.pagePath} 畫面出錯：${reason}`,
      // 元件堆疊只進 log 方便除錯，畫面上不顯示
      { componentStack: info.componentStack },
    );
    writeLog({
      level: 'error',
      module: this.props.module,
      action: `顯示頁面：${this.props.pagePath}`,
      error,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="platform-infrastructure-page">
        <section className="platform-infrastructure-card">
          <EmptyState text={getText('PlatformInfrastructure.contentError.title')}>
            <Button onClick={() => window.location.reload()}>
              {getText('PlatformInfrastructure.contentError.reload')}
            </Button>
          </EmptyState>
        </section>
      </div>
    );
  }
}
