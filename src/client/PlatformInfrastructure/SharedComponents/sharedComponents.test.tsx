// @vitest-environment jsdom
// 共用元件：彈出視窗、確認視窗、提示訊息、錯誤訊息、可搜尋的下拉選單、輸入框、開關、按鈕、任務進度。

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import { Button, TextInput, Toggle } from './basicControls.tsx';
import { TaskProgress } from './feedback.tsx';
import {
  closeAllModals,
  hasUnsavedModal,
  showConfirm,
  showModal,
  type ModalControls,
} from './modals.tsx';
import { NOTICE_LIMIT, showError, showToast } from './notices.tsx';
import { OverlayHost } from './OverlayHost.tsx';
import { PageHero } from './PageHero.tsx';
import { Select, type SelectOption } from './Select.tsx';

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.useRealTimers();
});

const SAMPLE_ERROR: PlatformError = {
  module: 'PlatformInfrastructure',
  interfaceName: 'updateSettings',
  code: 'SETTINGS_THEME_NOT_FOUND',
  message: '寫給開發者看的訊息',
  details: { theme: 'sakura' },
};

function dialogs(): HTMLElement[] {
  return screen.queryAllByRole('dialog');
}

function pressEscape(target: Element = document.body): void {
  fireEvent.keyDown(target, { key: 'Escape' });
}

/** 有一個輸入框的視窗內容：打字後回報有未儲存的修改。 */
function EditableContent({ controls }: { controls: ModalControls }) {
  const [text, setText] = useState('');
  useEffect(() => controls.setHasUnsavedChanges(text !== ''), [controls, text]);
  return <TextInput value={text} onChange={setText} ariaLabel="名稱" />;
}

function openEditableModal(): void {
  act(() => {
    showModal({
      title: '新增模型',
      content: (controls) => <EditableContent controls={controls} />,
    });
  });
}

// ===== 彈出視窗 =====

describe('SharedComponents 彈出視窗', () => {
  it('點背景不關閉；沒有修改時按 X 或 Esc 直接關閉', () => {
    render(<OverlayHost />);
    openEditableModal();
    fireEvent.click(document.querySelector('.platform-infrastructure-backdrop')!);
    expect(dialogs()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(dialogs()).toHaveLength(0);

    openEditableModal();
    pressEscape();
    expect(dialogs()).toHaveLength(0);
  });

  it('有修改時先詢問；Esc 只關掉確認視窗；連按兩次 X 只出現一個確認視窗', async () => {
    render(<OverlayHost />);
    openEditableModal();
    fireEvent.change(screen.getByRole('textbox', { name: '名稱' }), { target: { value: 'A' } });
    expect(hasUnsavedModal()).toBe(true);

    const closeButton = within(dialogs()[0]).getByRole('button', { name: '關閉' });
    fireEvent.click(closeButton);
    fireEvent.click(closeButton);
    expect(dialogs()).toHaveLength(2);
    expect(screen.getByText('修改還沒儲存，確定不儲存並離開嗎？')).toBeTruthy();

    await act(async () => pressEscape());
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveProperty('value', 'A');

    fireEvent.click(closeButton);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '不儲存並離開' })));
    expect(dialogs()).toHaveLength(0);
  });

  it('視窗內容可以自己關閉視窗（例如儲存成功），不詢問', () => {
    render(<OverlayHost />);
    let controls: ModalControls | undefined;
    act(() => {
      showModal({
        title: '新增模型',
        content: (modalControls) => {
          controls = modalControls;
          return <p>內容</p>;
        },
      });
    });
    act(() => {
      controls?.setHasUnsavedChanges(true);
      controls?.close();
    });
    expect(dialogs()).toHaveLength(0);
  });

  it('closeAllModals 不經確認關閉所有視窗，開著的確認視窗算沒有確認', async () => {
    render(<OverlayHost />);
    openEditableModal();
    let confirmResult: Promise<boolean> | undefined;
    act(() => {
      confirmResult = showConfirm({ title: '刪除', message: '確定？' });
    });
    expect(dialogs()).toHaveLength(2);

    act(() => closeAllModals());
    expect(dialogs()).toHaveLength(0);
    await expect(confirmResult).resolves.toBe(false);
  });
});

// ===== 確認視窗 =====

describe('SharedComponents 確認視窗', () => {
  it('危險操作的確認按鈕用危險樣式，焦點停在「取消」，按 Esc 不會確認', async () => {
    render(<OverlayHost />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = showConfirm({
        title: '刪除 API key',
        message: '有 2 個模型選用這組 key',
        confirmLabel: '刪除',
        isDanger: true,
      });
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '刪除' }).className).toContain('button-danger');

    await act(async () => pressEscape(document.activeElement!));
    await expect(result).resolves.toBe(false);
    expect(dialogs()).toHaveLength(0);
  });

  it('按確認回傳 true', async () => {
    render(<OverlayHost />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = showConfirm({ title: '刪除', message: '確定？' });
    });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await expect(result).resolves.toBe(true);
  });
});

// ===== 提示訊息、錯誤訊息 =====

describe('SharedComponents 提示與錯誤訊息', () => {
  it('成功提示約 3 秒後消失，警告 5 秒後消失；同時最多 5 則', () => {
    vi.useFakeTimers();
    render(<OverlayHost />);
    act(() => {
      showToast('success', '已儲存');
      showToast('warning', '小心');
    });
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByText('已儲存')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('已儲存')).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('小心')).toBeNull();

    act(() => {
      for (let index = 1; index <= NOTICE_LIMIT + 2; index++) showToast('info', `第 ${index} 則`);
    });
    expect(document.querySelectorAll('.platform-infrastructure-toast')).toHaveLength(NOTICE_LIMIT);
    expect(screen.queryByText('第 1 則')).toBeNull();
    expect(screen.getByText(`第 ${NOTICE_LIMIT + 2} 則`)).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
  });

  it('錯誤訊息第一行是白話說明、第二行是模組、介面、代碼，不顯示訊息和細節，按 X 才關閉', () => {
    vi.useFakeTimers();
    render(<OverlayHost />);
    act(() => showError(SAMPLE_ERROR));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('找不到選擇的主題');
    expect(alert.textContent).toContain(
      'PlatformInfrastructure／updateSettings（代碼：SETTINGS_THEME_NOT_FOUND）',
    );
    expect(alert.textContent).not.toContain('寫給開發者看的訊息');

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ===== 下拉選單 =====

const PROVIDERS: SelectOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter', hint: '多家模型' },
  { value: 'grok', label: 'Grok' },
];

/** 自己管理值的可搜尋選單，方便測試選擇的結果。 */
function SearchableProviderSelect({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Select
      value={value}
      options={PROVIDERS}
      hasPlaceholder
      ariaLabel="供應商"
      searchPlaceholder="搜尋供應商"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function optionLabels(): string[] {
  return screen.queryAllByRole('option').map((option) => option.firstChild?.textContent ?? '');
}

describe('SharedComponents 下拉選單', () => {
  it('可搜尋的選單只列出符合的選項，搜尋時不顯示「-- 請選擇 --」', () => {
    render(<SearchableProviderSelect />);
    fireEvent.click(screen.getByRole('button', { name: '供應商' }));
    const search = screen.getByRole('textbox', { name: '搜尋供應商' });
    expect(document.activeElement).toBe(search);
    expect(optionLabels()).toEqual(['-- 請選擇 --', 'OpenAI', 'OpenRouter', 'Grok']);

    fireEvent.change(search, { target: { value: 'open' } });
    expect(optionLabels()).toEqual(['OpenAI', 'OpenRouter']);
    fireEvent.change(search, { target: { value: '多家' } });
    expect(optionLabels()).toEqual(['OpenRouter']);
  });

  it('↑↓、Enter 可以選擇；Esc 收合選單；再打開時搜尋已清空', () => {
    const onChange = vi.fn();
    render(<SearchableProviderSelect onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '供應商' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const search = screen.getByRole('textbox', { name: '搜尋供應商' });
    fireEvent.change(search, { target: { value: 'o' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('openrouter');
    expect(trigger.textContent).toBe('OpenRouter');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: '搜尋供應商' })).toHaveProperty('value', '');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜尋供應商' }), { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('視窗內的選單按 Esc 只收合選單，視窗還在', () => {
    render(<OverlayHost />);
    act(() => {
      showModal({ title: '新增模型', content: <SearchableProviderSelect /> });
    });
    const trigger = screen.getByRole('button', { name: '供應商' });
    fireEvent.click(trigger);
    pressEscape(screen.getByRole('textbox', { name: '搜尋供應商' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(dialogs()).toHaveLength(1);

    pressEscape(trigger);
    expect(dialogs()).toHaveLength(0);
  });
});

// ===== 基本元件 =====

describe('SharedComponents 基本元件', () => {
  it('儲存時按鈕轉圈、不能再按', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} isBusy busyLabel="儲存中">
        儲存
      </Button>,
    );
    const button = screen.getByRole('button', { name: '儲存中' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.platform-infrastructure-spinner')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('輸入框有一般、密碼、數字三種；格式錯誤時紅框', () => {
    render(
      <>
        <TextInput value="" onChange={() => {}} ariaLabel="名稱" />
        <TextInput value="" onChange={() => {}} type="password" ariaLabel="key" />
        <TextInput value="-1" onChange={() => {}} type="number" ariaLabel="價格" isInvalid />
      </>,
    );
    expect(screen.getByLabelText('名稱').getAttribute('type')).toBe('text');
    expect(screen.getByLabelText('key').getAttribute('type')).toBe('password');
    const price = screen.getByLabelText('價格');
    expect(price.getAttribute('type')).toBe('number');
    expect(price.className).toContain('is-invalid');
  });

  it('開關按一下切換開與關', () => {
    function ToggleSample() {
      const [isOn, setIsOn] = useState(false);
      return <Toggle isOn={isOn} onChange={setIsOn} ariaLabel="網頁搜尋" />;
    }
    render(<ToggleSample />);
    const toggle = screen.getByRole('switch', { name: '網頁搜尋' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('is-on');
  });
});

// ===== 頁首 =====

describe('SharedComponents 頁首', () => {
  it('頁首顯示英文淡字、英文小標、標題、說明和使用模組提供的看板角色圖', () => {
    const { container } = render(
      <PageHero
        display="Characters"
        eyebrow="Characters"
        title="角色"
        description="為每個角色選模型、寫個性"
        bannerUrl="/theme/default/ChatRoom/charactersBanner.png"
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: '角色' })).toBeTruthy();
    expect(screen.getByText('為每個角色選模型、寫個性')).toBeTruthy();
    expect(container.querySelector('.platform-infrastructure-display-text')?.textContent).toBe(
      'Characters',
    );
    expect(container.querySelector('.platform-infrastructure-eyebrow')?.textContent).toBe(
      'Characters',
    );
    const banner = container.querySelector('img.platform-infrastructure-hero-character');
    expect(banner?.getAttribute('src')).toBe('/theme/default/ChatRoom/charactersBanner.png');
  });
});

// ===== 任務進度 =====

describe('SharedComponents 任務進度', () => {
  it('依狀態顯示：排隊中、處理中（有／沒有百分比）、完成、失敗與原因', () => {
    const { rerender, container } = render(<TaskProgress status="queued" />);
    expect(screen.getByText('排隊中')).toBeTruthy();
    expect(container.querySelector('.platform-infrastructure-spinner')).not.toBeNull();

    rerender(<TaskProgress status="running" />);
    expect(screen.getByText('處理中')).toBeTruthy();
    expect(container.querySelector('.platform-infrastructure-progress')).toBeNull();

    rerender(<TaskProgress status="running" percent={42.4} />);
    expect(screen.getByText('42%')).toBeTruthy();
    const fill = container.querySelector<HTMLElement>('.platform-infrastructure-progress-fill');
    expect(fill?.style.width).toBe('42.4%');
    expect(container.querySelector('.platform-infrastructure-spinner')).toBeNull();

    rerender(<TaskProgress status="completed" />);
    expect(screen.getByText('完成')).toBeTruthy();

    rerender(<TaskProgress status="failed" error={SAMPLE_ERROR} />);
    expect(screen.getByText('失敗')).toBeTruthy();
    expect(screen.getByText('找不到選擇的主題')).toBeTruthy();
  });
});
