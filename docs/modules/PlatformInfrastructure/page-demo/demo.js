/*
 * PlatformInfrastructure demo 共用的互動：外殼（log 列、換頁攔截）、共用元件（下拉選單、確認視窗、提示訊息）。
 * 只是畫面草稿用的假互動，不接後端；實作時以 React 元件重寫。
 */
(function () {
  'use strict';

  var PREFIX = 'platform-infrastructure-';

  // ===== 假的 log 資料（新的在前） =====

  var DEMO_LOGS = [
    { time: '11-25 14:32:08', level: 'success', module: 'PlatformInfrastructure', action: '儲存基礎設定', duration: '12ms' },
    {
      time: '11-25 14:30:41', level: 'error', module: 'PlatformInfrastructure', action: '測試模型「GPT-4.1 mini」',
      duration: '1.2s', keyName: '工作用',
      error: {
        plain: 'API key 無效，請確認 key 是否正確',
        source: 'PlatformInfrastructure／testModel（代碼：MODEL_KEY_INVALID）',
        message: 'testModel：呼叫 OpenAI /v1/chat/completions 時回傳 401，key 驗證失敗',
        detail: '{\n  "status": 401,\n  "error": {\n    "message": "Incorrect API key provided",\n    "type": "invalid_request_error"\n  }\n}'
      }
    },
    { time: '11-25 14:29:55', level: 'warning', module: 'ChatRoom', action: '串流回覆訊息', status: '已取消', duration: '3.4s', keyName: '個人' },
    { time: '11-25 14:27:12', level: 'success', module: 'ChatRoom', action: '回覆訊息', duration: '5.1s', usage: '輸入 1,204／輸出 356 token', keyName: '個人' },
    {
      time: '11-25 14:20:03', level: 'warning', module: 'PlatformInfrastructure', action: '新增 API key',
      error: {
        plain: '同一家供應商已經有這個名稱的 key',
        source: 'PlatformInfrastructure／addApiKey（代碼：API_KEY_NAME_DUPLICATE）',
        message: 'addApiKey：OpenAI 已有名稱為「工作用」的 key',
        detail: '{ "provider": "openai", "name": "工作用" }'
      }
    },
    { time: '11-25 14:18:47', level: 'success', module: 'PlatformInfrastructure', action: '偵測模型（OpenRouter，312 個）', duration: '860ms', keyName: '個人' },
    { time: '11-25 14:15:30', level: 'success', module: 'PlatformInfrastructure', action: '新增 API key「個人」（OpenRouter）', duration: '9ms' },
    { time: '11-25 14:15:02', level: 'success', module: 'PlatformInfrastructure', action: '資料庫升級到第 1 版', duration: '31ms' },
    { time: '11-25 14:15:01', level: 'success', module: 'PlatformInfrastructure', action: '平台初始化完成', duration: '240ms' }
  ];

  var LEVEL_LABELS = { success: '正確', warning: '警告', error: '錯誤' };
  var LEVEL_BADGES = { success: 'is-success', warning: 'is-warning', error: 'is-danger' };

  // ===== 主要流程 =====

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-select]').forEach(setupSelect);
    document.querySelectorAll('[data-logbar]').forEach(setupLogBar);
    document.querySelectorAll('[data-nav]').forEach(setupNavLink);
    window.addEventListener('beforeunload', function (event) {
      if (!window.PlatformDemo.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  });

  // 給各畫面使用的小工具
  window.PlatformDemo = {
    // 畫面自己設定「有沒有未儲存的修改」的判斷方式
    isDirty: function () { return false; },
    showToast: showToast,
    showError: showError,
    showConfirm: showConfirm,
    setState: setState,
    // 畫面自己用 JS 畫出來的下拉選單，畫完後要呼叫這個才能操作
    setupSelect: setupSelect
  };

  // ===== 換頁（navbar、側邊欄） =====

  function setupNavLink(link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      if (link.classList.contains('is-active')) return;
      var target = link.getAttribute('href');
      leaveTo(target, link.textContent.trim());
    });
  }

  // 有未儲存的修改時先詢問（文字依 conventions 第 9 段的固定文字）
  function leaveTo(target, label) {
    var go = function () {
      if (target && target !== '#') {
        location.href = target;
        return;
      }
      showToast('info', '範例版還沒有做「' + label + '」這個畫面');
    };
    if (!window.PlatformDemo.isDirty()) {
      go();
      return;
    }
    showConfirm({
      title: '尚未儲存',
      message: '修改還沒儲存，確定不儲存並離開嗎？',
      confirmText: '不儲存並離開',
      isDanger: true
    }).then(function (isConfirmed) {
      if (isConfirmed) go();
    });
  }

  // ===== 畫面狀態 =====

  function setState(state) {
    document.querySelectorAll('[data-state]').forEach(function (el) {
      el.style.display = el.getAttribute('data-state') === state ? '' : 'none';
    });
  }

  // ===== 下拉選單 =====

  function setupSelect(root) {
    var trigger = root.querySelector('.' + PREFIX + 'select-trigger');
    var list = root.querySelector('.' + PREFIX + 'select-list');
    var search = root.querySelector('.' + PREFIX + 'select-search');
    var placeholder = root.getAttribute('data-placeholder');
    var highlighted = -1;

    function options() {
      return Array.prototype.filter.call(
        list.querySelectorAll('.' + PREFIX + 'select-option'),
        function (o) { return o.style.display !== 'none'; }
      );
    }

    function render() {
      var value = root.getAttribute('data-value') || '';
      var selected = list.querySelector('[data-value="' + value + '"]');
      var isEmpty = !value || !selected;
      trigger.textContent = isEmpty ? placeholder : selected.getAttribute('data-label') || selected.firstChild.textContent;
      trigger.classList.toggle('is-placeholder', isEmpty);
      list.querySelectorAll('.' + PREFIX + 'select-option').forEach(function (o) {
        o.classList.toggle('is-selected', o.getAttribute('data-value') === value && !!value);
      });
    }

    function open() {
      document.querySelectorAll('[data-select].is-open').forEach(function (other) {
        if (other !== root) other.classList.remove('is-open');
      });
      root.classList.add('is-open');
      if (search) {
        search.value = '';
        filter('');
        search.focus();
      }
      highlight(options().findIndex(function (o) { return o.classList.contains('is-selected'); }));
    }

    function close() {
      root.classList.remove('is-open');
      trigger.focus();
    }

    function choose(option) {
      root.setAttribute('data-value', option.getAttribute('data-value'));
      render();
      close();
      root.dispatchEvent(new CustomEvent('change', { bubbles: true }));
    }

    function highlight(index) {
      var all = options();
      all.forEach(function (o) { o.classList.remove('is-highlighted'); });
      if (all.length === 0) { highlighted = -1; return; }
      highlighted = Math.max(0, Math.min(index, all.length - 1));
      all[highlighted].classList.add('is-highlighted');
      all[highlighted].scrollIntoView({ block: 'nearest' });
    }

    // 搜尋時不顯示「-- 請選擇 --」（conventions 第 9 段）
    function filter(keyword) {
      list.querySelectorAll('.' + PREFIX + 'select-option').forEach(function (o) {
        var isPlaceholder = o.getAttribute('data-value') === '';
        var isMatch = o.textContent.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
        o.style.display = keyword ? (isMatch && !isPlaceholder ? '' : 'none') : '';
      });
      highlight(0);
    }

    function onKey(event) {
      if (!root.classList.contains('is-open')) {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
        return;
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); highlight(highlighted + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); highlight(highlighted - 1); }
      if (event.key === 'Enter') { event.preventDefault(); if (options()[highlighted]) choose(options()[highlighted]); }
      // 選單內按 Esc 只收合選單，不讓外層視窗收到
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    }

    trigger.addEventListener('click', function () {
      if (root.classList.contains('is-open')) close(); else open();
    });
    trigger.addEventListener('keydown', onKey);
    if (search) {
      search.addEventListener('keydown', onKey);
      search.addEventListener('input', function () { filter(search.value); });
    }
    list.addEventListener('click', function (event) {
      var option = event.target.closest('.' + PREFIX + 'select-option');
      if (option) choose(option);
    });
    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) root.classList.remove('is-open');
    });
    render();
  }

  // ===== 確認視窗 =====

  // 回傳 Promise：按確認為 true，按取消、X、Esc 為 false
  function showConfirm(config) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = PREFIX + 'backdrop';
      backdrop.innerHTML =
        '<div class="' + PREFIX + 'modal" role="dialog" aria-modal="true">' +
        '  <div class="' + PREFIX + 'modal-header">' +
        '    <h2 class="' + PREFIX + 'modal-title"></h2>' +
        '    <button type="button" class="' + PREFIX + 'icon-button" data-close aria-label="關閉">×</button>' +
        '  </div>' +
        '  <div class="' + PREFIX + 'modal-body"></div>' +
        '  <div class="' + PREFIX + 'modal-footer">' +
        '    <button type="button" class="' + PREFIX + 'button ' + PREFIX + 'button-secondary" data-cancel>取消</button>' +
        '    <button type="button" class="' + PREFIX + 'button ' + PREFIX + (config.isDanger ? 'button-danger' : 'button-primary') + '" data-confirm></button>' +
        '  </div>' +
        '</div>';
      backdrop.querySelector('.' + PREFIX + 'modal-title').textContent = config.title;
      backdrop.querySelector('.' + PREFIX + 'modal-body').textContent = config.message;
      backdrop.querySelector('[data-confirm]').textContent = config.confirmText || '確認';

      function finish(result) {
        document.removeEventListener('keydown', onEsc, true);
        backdrop.remove();
        resolve(result);
      }
      function onEsc(event) {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        finish(false);
      }

      // 點背景不關閉（SharedComponents 規則），所以背景不掛點擊事件
      backdrop.querySelector('[data-close]').addEventListener('click', function () { finish(false); });
      backdrop.querySelector('[data-cancel]').addEventListener('click', function () { finish(false); });
      backdrop.querySelector('[data-confirm]').addEventListener('click', function () { finish(true); });
      document.addEventListener('keydown', onEsc, true);
      document.body.appendChild(backdrop);
      // 焦點預設停在「取消」，避免誤按 Enter 執行危險操作
      backdrop.querySelector('[data-cancel]').focus();
    });
  }

  // ===== 提示訊息 =====

  var TOAST_LIMIT = 5;
  var TOAST_DURATIONS = { success: 3000, info: 3000, warning: 5000 };

  function showToast(type, text) {
    var area = getToastArea();
    var toast = document.createElement('div');
    toast.className = PREFIX + 'toast is-' + type;
    toast.textContent = text;
    area.appendChild(toast);
    while (area.children.length > TOAST_LIMIT) area.firstChild.remove();
    setTimeout(function () { toast.remove(); }, TOAST_DURATIONS[type] || 3000);
  }

  // 錯誤訊息：第一行白話說明、第二行「模組／介面（代碼：…）」；不會自動消失，要按 X
  function showError(error) {
    var area = getToastArea();
    var box = document.createElement('div');
    box.className = PREFIX + 'error-message';
    box.innerHTML =
      '<span class="' + PREFIX + 'error-message-icon">!</span>' +
      '<div class="' + PREFIX + 'error-message-body">' +
      '  <div class="' + PREFIX + 'error-message-title"></div>' +
      '  <div class="' + PREFIX + 'error-message-source"></div>' +
      '</div>' +
      '<button type="button" class="' + PREFIX + 'icon-button" aria-label="關閉">×</button>';
    box.querySelector('.' + PREFIX + 'error-message-title').textContent = error.plain;
    box.querySelector('.' + PREFIX + 'error-message-source').textContent = error.source;
    box.querySelector('button').addEventListener('click', function () { box.remove(); });
    area.appendChild(box);
    while (area.children.length > TOAST_LIMIT) area.firstChild.remove();
  }

  function getToastArea() {
    var area = document.querySelector('.' + PREFIX + 'toast-area');
    if (area) return area;
    area = document.createElement('div');
    area.className = PREFIX + 'toast-area';
    document.body.appendChild(area);
    return area;
  }

  // ===== log 列 =====

  function setupLogBar(bar) {
    var summary = bar.querySelector('.' + PREFIX + 'logbar-summary');
    var list = bar.querySelector('.' + PREFIX + 'logbar-list');
    var tabs = bar.querySelectorAll('[data-log-filter]');

    renderSummary(summary, DEMO_LOGS[0]);
    renderLogList(list, 'all');

    summary.addEventListener('click', function () {
      var isExpanded = bar.classList.toggle('is-expanded');
      summary.querySelector('.' + PREFIX + 'logbar-arrow').textContent = isExpanded ? '▼ 收合' : '▲ 展開';
    });
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        renderLogList(list, tab.getAttribute('data-log-filter'));
      });
    });
    list.addEventListener('click', function (event) {
      var toggle = event.target.closest('.' + PREFIX + 'log-error-toggle');
      if (!toggle) return;
      var entry = toggle.closest('.' + PREFIX + 'log-entry');
      var isOpen = entry.classList.toggle('is-detail-open');
      toggle.textContent = isOpen ? '收起' : '看細節';
    });
  }

  function renderSummary(summary, log) {
    var main = summary.querySelector('[data-log-latest]');
    if (!log) {
      main.textContent = '目前沒有 log';
      return;
    }
    main.innerHTML = logMainHtml(log, false);
  }

  function renderLogList(list, filter) {
    var logs = DEMO_LOGS.filter(function (log) { return filter === 'all' || log.level === filter; });
    list.innerHTML = logs.map(function (log) {
      var errorHtml = log.error
        ? '<div class="' + PREFIX + 'log-error">' + escapeHtml(log.error.plain) +
          '　<span class="' + PREFIX + 'error-message-source">' + escapeHtml(log.error.source) + '</span>' +
          '<button type="button" class="' + PREFIX + 'log-error-toggle">看細節</button></div>' +
          '<div class="' + PREFIX + 'log-detail">訊息：' + escapeHtml(log.error.message) + '\n細節：' + escapeHtml(log.error.detail) + '</div>'
        : '';
      return '<li class="' + PREFIX + 'log-entry">' + logMainHtml(log, true) + errorHtml + '</li>';
    }).join('') || '<li class="' + PREFIX + 'log-entry">這個等級沒有 log</li>';
  }

  // 一筆 log 的主要那一行；有值的欄位才顯示
  function logMainHtml(log, hasMeta) {
    var meta = [];
    if (hasMeta) {
      if (log.status) meta.push('狀態 ' + log.status);
      if (log.duration) meta.push('耗時 ' + log.duration);
      if (log.usage) meta.push(log.usage);
      if (log.keyName) meta.push('key：' + log.keyName);
    }
    return '<span class="' + PREFIX + 'log-entry-main">' +
      '<span class="' + PREFIX + 'log-time">' + log.time + '</span>' +
      '<span class="' + PREFIX + 'badge ' + LEVEL_BADGES[log.level] + '">' + LEVEL_LABELS[log.level] + '</span>' +
      '<span class="' + PREFIX + 'log-module">' + log.module + '</span>' +
      '<span>' + escapeHtml(log.action) + '</span>' +
      (meta.length ? '<span class="' + PREFIX + 'log-meta">' + meta.map(function (m) { return '<span>' + escapeHtml(m) + '</span>'; }).join('') + '</span>' : '') +
      '</span>';
  }

  // ===== 輔助 =====

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
