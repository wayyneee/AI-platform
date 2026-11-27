/*
 * ChatRoom demo 的共用假互動：套上外殼（navbar、側邊欄、log 列）、圖示、彈出視窗、分頁、選單、開關、
 * 摺疊、勾選卡片、拉條數值、重要度星星、鎖定。各畫面自己的互動寫在各自的 HTML。
 * 網址參數：?open=<視窗 id> 直接打開某個視窗（截圖用）、?variant=<情境> 顯示對應的 data-variant 區塊。
 */
(function () {
  var script = document.currentScript;
  // 外殼的素材屬於 PlatformInfrastructure，demo 直接指到 default 主題的檔案
  var shellAssetRoot = new URL('../../../../public/theme/default/PlatformInfrastructure/', script.src).href;
  var params = new URLSearchParams(location.search);

  // ===== 圖示（stroke 用 currentColor，顏色跟著文字） =====

  var ICONS = {
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    clip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    mute: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/>',
    speak: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    play: '<path d="M5 3l14 9-14 9V3z"/>',
    drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    sparkle: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>'
  };

  function renderIcons(root) {
    root.querySelectorAll('i[data-icon]').forEach(function (holder) {
      var name = holder.getAttribute('data-icon');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('class', 'chat-room-icon' + (holder.hasAttribute('data-small') ? ' chat-room-icon-small' : ''));
      svg.innerHTML = ICONS[name] || '';
      holder.replaceWith(svg);
    });
  }

  // ===== 外殼 =====

  var PAGES = [
    { id: 'rooms', label: '聊天室', href: 'rooms.html' },
    { id: 'characters', label: '角色', href: 'characters.html' },
    { id: 'templates', label: '角色模板', href: 'templates.html' },
    { id: 'personas', label: '人設', href: 'personas.html' },
    { id: 'books', label: '知識書', href: 'books.html' },
    { id: 'settings', label: '聊天設定', href: 'settings.html' }
  ];

  function buildShell() {
    var content = document.getElementById('chat-room-demo-content');
    if (!content) return;
    var current = document.body.getAttribute('data-page');

    var shell = document.createElement('div');
    shell.className = 'platform-infrastructure-shell';
    shell.style.backgroundImage = 'url("' + shellAssetRoot + 'appBackground.png")';

    var sidebarItems = PAGES.map(function (page) {
      return '<a class="platform-infrastructure-sidebar-item' + (page.id === current ? ' is-active' : '') +
        '" href="' + page.href + '">' + page.label + '</a>';
    }).join('');

    shell.innerHTML =
      '<header class="platform-infrastructure-navbar">' +
      '  <img class="platform-infrastructure-navbar-logo" src="' + shellAssetRoot + 'platformLogo.png" alt="平台標誌">' +
      '  <a class="platform-infrastructure-navbar-item is-active" href="rooms.html">聊天</a>' +
      '  <a class="platform-infrastructure-navbar-item" href="#">小說工作室</a>' +
      '  <a class="platform-infrastructure-navbar-item" href="#">多媒體創作</a>' +
      '  <span class="platform-infrastructure-navbar-spacer"></span>' +
      '  <a class="platform-infrastructure-navbar-item" href="#">平台設定</a>' +
      '</header>' +
      '<div class="platform-infrastructure-body">' +
      '  <nav class="platform-infrastructure-sidebar">' +
      '    <div class="platform-infrastructure-sidebar-header">' +
      '      <div class="platform-infrastructure-eyebrow">Chat</div>' +
      '      <div class="platform-infrastructure-sidebar-title">聊天</div>' +
      '    </div>' + sidebarItems +
      '  </nav>' +
      '  <main class="platform-infrastructure-content"></main>' +
      '</div>' +
      '<footer class="platform-infrastructure-logbar">' +
      '  <button type="button" class="platform-infrastructure-logbar-summary">' +
      '    <span class="platform-infrastructure-log-time">11-27 21:42:18</span>' +
      '    <span class="platform-infrastructure-badge is-success">正確</span>' +
      '    <span class="platform-infrastructure-log-module">ChatRoom</span>' +
      '    <span>角色回覆完成：米婭（夜城偵探社）</span>' +
      '    <span class="platform-infrastructure-logbar-arrow">▲ 展開</span>' +
      '  </button>' +
      '</footer>';

    content.parentNode.insertBefore(shell, content);
    shell.querySelector('.platform-infrastructure-content').appendChild(content);
  }

  // ===== 彈出視窗 =====

  function openModal(id) {
    var modal = document.getElementById(id);
    if (modal) modal.hidden = false;
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function topOpenModal() {
    var open = Array.prototype.filter.call(document.querySelectorAll('[data-modal]'), function (m) { return !m.hidden; });
    return open[open.length - 1];
  }

  // ===== 事件 =====

  document.addEventListener('click', function (event) {
    var target = event.target;

    var opener = target.closest('[data-open]');
    if (opener) {
      openModal(opener.getAttribute('data-open'));
      return;
    }

    var closer = target.closest('[data-close]');
    if (closer) {
      closeModal(closer.closest('[data-modal]'));
      return;
    }

    // 分頁：同一組 [data-tabs] 裡切換，對應的 [data-tab-panel] 顯示
    var tab = target.closest('[data-tab]');
    if (tab) {
      var group = tab.closest('[data-tabs]');
      var groupName = group.getAttribute('data-tabs');
      group.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
      document.querySelectorAll('[data-tab-panel^="' + groupName + ':"]').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-tab-panel') !== groupName + ':' + tab.getAttribute('data-tab');
      });
      return;
    }

    // 共用的下拉選單
    var trigger = target.closest('.platform-infrastructure-select-trigger');
    if (trigger) {
      var select = trigger.closest('.platform-infrastructure-select');
      var wasOpen = select.classList.contains('is-open');
      closeAllPopups();
      select.classList.toggle('is-open', !wasOpen);
      return;
    }
    var option = target.closest('.platform-infrastructure-select-option');
    if (option) {
      var owner = option.closest('.platform-infrastructure-select');
      owner.querySelectorAll('.platform-infrastructure-select-option').forEach(function (o) {
        o.classList.toggle('is-selected', o === option);
      });
      var label = owner.querySelector('.platform-infrastructure-select-trigger');
      label.textContent = option.getAttribute('data-label') || option.childNodes[0].textContent.trim();
      label.classList.toggle('is-placeholder', option.hasAttribute('data-placeholder'));
      owner.classList.remove('is-open', 'is-invalid');
      return;
    }

    // 小選單（成員頭像、人設選單）
    var menuOwner = target.closest('[data-menu-owner]');
    if (menuOwner && !target.closest('.chat-room-menu')) {
      var menu = menuOwner.querySelector('.chat-room-menu');
      var isOpen = menu.classList.contains('is-open');
      closeAllPopups();
      menu.classList.toggle('is-open', !isOpen);
      return;
    }
    if (target.closest('.chat-room-menu-item')) {
      target.closest('.chat-room-menu').classList.remove('is-open');
      // 不 return：讓各畫面自己的處理接著跑
    } else if (!target.closest('.platform-infrastructure-select')) {
      closeAllPopups();
    }

    var toggle = target.closest('.platform-infrastructure-toggle');
    if (toggle && !toggle.disabled) {
      toggle.classList.toggle('is-on');
      return;
    }

    var fold = target.closest('.chat-room-fold-toggle');
    if (fold) {
      fold.closest('.chat-room-fold').classList.toggle('is-open');
      return;
    }

    var systemLine = target.closest('button.chat-room-system-pill');
    if (systemLine) {
      systemLine.closest('.chat-room-system-line').classList.toggle('is-open');
      return;
    }

    var check = target.closest('.chat-room-check-item');
    if (check) {
      check.classList.toggle('is-checked');
      return;
    }

    var star = target.closest('.chat-room-importance button');
    if (star) {
      var stars = star.parentNode.querySelectorAll('button');
      var level = Array.prototype.indexOf.call(stars, star);
      stars.forEach(function (s, index) { s.classList.toggle('is-on', index <= level); });
      return;
    }

    var lock = target.closest('.chat-room-lock');
    if (lock) {
      var isLocked = !lock.classList.contains('is-on');
      lock.classList.toggle('is-on', isLocked);
      lock.closest('.chat-room-memory-item').classList.toggle('is-locked', isLocked);
      lock.innerHTML = '<i data-icon="' + (isLocked ? 'lock' : 'unlock') + '"></i>';
      renderIcons(lock);
      return;
    }

    // 分段目錄：點了把右邊捲到那一段
    var sectionLink = target.closest('.chat-room-section-nav a');
    if (sectionLink) {
      event.preventDefault();
      var section = document.getElementById(sectionLink.getAttribute('href').slice(1));
      sectionLink.parentNode.querySelectorAll('a').forEach(function (a) { a.classList.toggle('is-active', a === sectionLink); });
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  function closeAllPopups() {
    document.querySelectorAll('.platform-infrastructure-select.is-open').forEach(function (s) { s.classList.remove('is-open'); });
    document.querySelectorAll('.chat-room-menu.is-open').forEach(function (m) { m.classList.remove('is-open'); });
  }

  // Esc 只關最上面的視窗；點背景不關閉（共用元件的規則）
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var openPopup = document.querySelector('.platform-infrastructure-select.is-open, .chat-room-menu.is-open');
    if (openPopup) {
      closeAllPopups();
      return;
    }
    var modal = topOpenModal();
    if (modal) closeModal(modal);
  });

  // 拉條：旁邊的數值跟著變
  document.addEventListener('input', function (event) {
    var range = event.target.closest('.chat-room-range input[type="range"]');
    if (!range) return;
    var value = range.parentNode.querySelector('.chat-room-range-value');
    if (value) value.textContent = formatRangeValue(range);
  });

  function formatRangeValue(range) {
    var number = Number(range.value);
    var unit = range.getAttribute('data-unit') || '';
    var text = range.hasAttribute('data-decimal') ? number.toFixed(2) : number.toLocaleString('en-US');
    return text + unit;
  }

  // ===== 啟動 =====

  // demo 用 hidden 屬性開關視窗與分頁；共用元件的 class 有 display，要讓 hidden 優先（只有 demo 需要）
  var hiddenStyle = document.createElement('style');
  hiddenStyle.textContent = '[hidden]{display:none !important}';
  document.head.appendChild(hiddenStyle);

  buildShell();
  renderIcons(document);

  document.querySelectorAll('.chat-room-range input[type="range"]').forEach(function (range) {
    var value = range.parentNode.querySelector('.chat-room-range-value');
    if (value) value.textContent = formatRangeValue(range);
  });

  var variant = params.get('variant');
  document.querySelectorAll('[data-variant]').forEach(function (el) {
    var names = el.getAttribute('data-variant').split(' ');
    var isNot = el.hasAttribute('data-variant-not');
    var matches = names.indexOf(variant) !== -1;
    el.hidden = isNot ? matches : !matches;
  });

  var toOpen = params.get('open');
  if (toOpen) toOpen.split(',').forEach(openModal);

  window.ChatRoomDemo = { openModal: openModal, renderIcons: renderIcons };
})();
