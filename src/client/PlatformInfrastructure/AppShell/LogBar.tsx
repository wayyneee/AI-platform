// log 列：畫面最下方，收合時只顯示最新一筆；點一下往上展開成完整列表，可以依等級篩選，新的 log 即時出現。

import { useEffect, useState } from 'react';

import type { LogEntry, LogLevel } from '../../../shared/PlatformInfrastructure/types.ts';
import { Badge, describeErrorSource, joinClassNames, Tabs } from '../SharedComponents/index.ts';
import type { TabItem } from '../SharedComponents/index.ts';
import { listLogs, subscribeLogs } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { formatDuration, formatLogTime, LOG_LEVEL_TONES, mergeLogEntries } from './logFormat.ts';

type LogFilter = 'all' | LogLevel;

const LOG_LEVELS: LogLevel[] = ['success', 'warning', 'error'];
const JSON_INDENT = 2;

// ===== 元件 =====

/** 畫面最下方的 log 列。 */
export function LogBar() {
  const entries = useLiveLogEntries();
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');

  const visibleEntries =
    filter === 'all' ? entries : entries.filter((entry) => entry.level === filter);
  const latest = entries[0];

  return (
    <footer
      className={joinClassNames('platform-infrastructure-logbar', isExpanded && 'is-expanded')}
    >
      <div className="platform-infrastructure-logbar-panel">
        <div className="platform-infrastructure-logbar-toolbar">
          <Tabs items={filterTabs()} value={filter} onChange={setFilter} />
          <span className="platform-infrastructure-hint">
            {getText('PlatformInfrastructure.logBar.limitHint')}
          </span>
        </div>
        <ul className="platform-infrastructure-logbar-list">
          {visibleEntries.map((entry) => (
            <LogEntryItem key={entry.id} entry={entry} />
          ))}
          {visibleEntries.length === 0 && (
            <li className="platform-infrastructure-log-entry">
              {getText('PlatformInfrastructure.logBar.emptyLevel')}
            </li>
          )}
        </ul>
      </div>
      <button
        type="button"
        className="platform-infrastructure-logbar-summary"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>
          {latest ? (
            <LogEntryMain entry={latest} hasMeta={false} />
          ) : (
            getText('PlatformInfrastructure.logBar.empty')
          )}
        </span>
        <span className="platform-infrastructure-logbar-arrow">
          {getText(
            isExpanded
              ? 'PlatformInfrastructure.logBar.collapse'
              : 'PlatformInfrastructure.logBar.expand',
          )}
        </span>
      </button>
    </footer>
  );
}

// ===== 一筆 log =====

function LogEntryItem({ entry }: { entry: LogEntry }) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const error = entry.error;
  return (
    <li
      className={joinClassNames(
        'platform-infrastructure-log-entry',
        isDetailOpen && 'is-detail-open',
      )}
    >
      <LogEntryMain entry={entry} hasMeta />
      {error && (
        <>
          <div className="platform-infrastructure-log-error">
            {getText(`errors.${error.code}`)}
            <span className="platform-infrastructure-error-message-source">
              {describeErrorSource(error)}
            </span>
            <button
              type="button"
              className="platform-infrastructure-log-error-toggle"
              onClick={() => setIsDetailOpen(!isDetailOpen)}
            >
              {getText(
                isDetailOpen
                  ? 'PlatformInfrastructure.logBar.hideDetail'
                  : 'PlatformInfrastructure.logBar.showDetail',
              )}
            </button>
          </div>
          <div className="platform-infrastructure-log-detail">{describeErrorDetail(entry)}</div>
        </>
      )}
    </li>
  );
}

/** 一筆 log 的主要那一行：時間、等級、模組、做了什麼；hasMeta 時加上有值的狀態、耗時、用量、key 名稱。 */
function LogEntryMain({ entry, hasMeta }: { entry: LogEntry; hasMeta: boolean }) {
  const meta = hasMeta ? describeMeta(entry) : [];
  return (
    <span className="platform-infrastructure-log-entry-main">
      <span className="platform-infrastructure-log-time">{formatLogTime(entry.time)}</span>
      <Badge tone={LOG_LEVEL_TONES[entry.level]}>
        {getText(`PlatformInfrastructure.logLevel.${entry.level}`)}
      </Badge>
      <span className="platform-infrastructure-log-module">{entry.module}</span>
      <span>{entry.action}</span>
      {meta.length > 0 && (
        <span className="platform-infrastructure-log-meta">
          {meta.map((text) => (
            <span key={text}>{text}</span>
          ))}
        </span>
      )}
    </span>
  );
}

// ===== 資料 =====

/** 即時的 log 列表：連上後端時查一次（斷線重連後也重查，補上漏掉的），之後收到新的就加進去。 */
function useLiveLogEntries(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  useEffect(() => {
    const addEntries = (incoming: LogEntry[]) =>
      setEntries((current) => mergeLogEntries(current, incoming));
    return subscribeLogs({
      onEntry: (entry) => addEntries([entry]),
      onConnected: () => {
        // 查不到時保留畫面上已有的 log，等下次重連再查
        listLogs()
          .then(addEntries)
          .catch(() => undefined);
      },
    });
  }, []);
  return entries;
}

// ===== 輔助 =====

function filterTabs(): TabItem<LogFilter>[] {
  return [
    { value: 'all', label: getText('PlatformInfrastructure.logBar.filterAll') },
    ...LOG_LEVELS.map((level) => ({
      value: level,
      label: getText(`PlatformInfrastructure.logLevel.${level}`),
    })),
  ];
}

function describeMeta(entry: LogEntry): string[] {
  const meta: string[] = [];
  if (entry.status)
    meta.push(getText('PlatformInfrastructure.logBar.status', { status: entry.status }));
  if (entry.durationMs !== undefined) {
    const duration = formatDuration(entry.durationMs);
    meta.push(getText('PlatformInfrastructure.logBar.duration', { duration }));
  }
  if (entry.usage) meta.push(entry.usage);
  if (entry.keyName)
    meta.push(getText('PlatformInfrastructure.logBar.keyName', { keyName: entry.keyName }));
  return meta;
}

/** 點開後看到的訊息和細節（寫給開發者看的內容）。 */
function describeErrorDetail(entry: LogEntry): string {
  if (!entry.error) return '';
  const lines = [
    getText('PlatformInfrastructure.logBar.detailMessage', { message: entry.error.message }),
  ];
  if (entry.error.details !== undefined) {
    const details = JSON.stringify(entry.error.details, null, JSON_INDENT);
    lines.push(getText('PlatformInfrastructure.logBar.detailDetails', { details }));
  }
  return lines.join('\n');
}
