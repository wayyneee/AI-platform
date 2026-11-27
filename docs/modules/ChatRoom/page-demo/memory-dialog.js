/*
 * 記憶視窗（MemoryDialog）的 demo：角色、聊天室、全域記憶共用同一個視窗。
 * 放上百條假記憶，搜尋、篩選、排序、鎖定、重要度、刪除、新增都能操作（不會真的存）。
 * 用法：在 demo.js 之後載入；按鈕加 data-open="memory-dialog" data-memory="character|room|global"。
 */
(function () {
  var ROOMS = ['夜城偵探社', '星港冒險隊', '咖啡廳日常', '英文家教'];

  // 每種記憶的標題、是否有「聊天室」篩選、條數、用量、假資料的內容來源
  var KINDS = {
    character: {
      title: '雷恩的記憶', eyebrow: 'Character Memory', hasRoomFilter: true, rooms: ['夜城偵探社', '星港冒險隊'], count: 124, used: 6200, total: 10000,
      pool: ['離開警隊的原因：七年前的「灰帽案」沒破，搭檔因此受傷。', '小夏找到了碼頭倉庫 02:17 的監視器畫面，和出入紀錄對不上。',
        '米婭說她怕水，所以那次寶藏探險沒有一起下船。', '老闆娘的咖啡記帳本上，偵探社已經欠了三個月。', '戒菸第 41 天，口袋裡的菸還沒丟。',
        '小夏第一次獨自跟監，回來時手在發抖，但沒有說。', '港務局的老趙欠我一個人情。', '灰帽男人每晚打烊前都去咖啡廳買外帶。',
        '米婭的情報網在舊市場，消息比警察快一天。', '第三倉庫的鑰匙只有三把，第三把下落不明。', '下雨天膝蓋舊傷會痛，不想讓別人知道。',
        '答應過小夏，案子破了要教她開鎖。', '星港的老船長說過，地圖上的 X 不一定是寶藏。', '不喜歡被叫「大叔」。']
    },
    room: {
      title: '聊天室記憶・夜城偵探社', eyebrow: 'Room Memory', hasRoomFilter: false, rooms: ['夜城偵探社'], count: 74, used: 3840, total: 10000,
      pool: ['偵探社和老闆娘約定：案子沒破之前，咖啡錢都先記帳。', '案發當晚 02:20 滿潮，小船可以直接靠進倉庫後門。',
        '倉庫的鑰匙只有三把：管理員、警局，第三把下落不明。', '失竊的都是「海燕貿易行」的貨。', '戴灰帽的男人每晚打烊前來買外帶。',
        '偵探社的窗戶看得到燈塔街的屋頂。', '港務局夜班從 22:00 到 06:00，每兩小時巡一次東碼頭。', '小夏在倉庫後門撿到一顆藍色鈕扣。']
    },
    global: {
      title: '全域記憶', eyebrow: 'Global Memory', hasRoomFilter: true, rooms: ROOMS, count: 43, used: 2150, total: 10000,
      pool: ['對花生過敏。', '喜歡推理小說，最近在讀橫溝正史。', '正在準備多益考試，目標 850 分，考試日期是 12 月 14 日。',
        '咖啡喜歡淺焙、不加糖。', '週末通常會去河濱騎腳踏車。', '養了一隻叫「麻糬」的橘貓。', '在台北的軟體公司上班，常加班到九點。']
    }
  };

  var DATE_STEP_HOURS = 9;
  var current = null;
  var entries = [];
  var isDirty = false;

  // ===== 假資料 =====

  /** 依條數產生假記憶：內容輪流取自 pool，重要度、時間、聊天室、鎖定錯開，看起來像真的。 */
  function makeEntries(kind) {
    var config = KINDS[kind];
    var list = [];
    var now = new Date(2026, 10, 27, 21, 40);
    for (var i = 0; i < config.count; i += 1) {
      var base = config.pool[i % config.pool.length];
      var round = Math.floor(i / config.pool.length);
      list.push({
        id: i,
        content: round === 0 ? base : base.replace(/。$/, '') + '（第 ' + (round + 1) + ' 次提到時補充的細節）。',
        importance: 5 - ((i * 7) % 5),
        isLocked: i % 11 === 0,
        room: config.rooms[(i * 3) % config.rooms.length],
        lastMentioned: new Date(now.getTime() - i * DATE_STEP_HOURS * 3600 * 1000)
      });
    }
    return list;
  }

  function formatDate(date) {
    return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  // ===== 視窗 =====

  function buildDialog() {
    var backdrop = document.createElement('div');
    backdrop.className = 'platform-infrastructure-backdrop';
    backdrop.id = 'memory-dialog';
    backdrop.setAttribute('data-modal', '');
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="platform-infrastructure-modal chat-room-dialog" role="dialog" aria-label="記憶">' +
      '  <div class="chat-room-dialog-header">' +
      '    <div class="chat-room-dialog-heading"><span class="platform-infrastructure-eyebrow" data-memory-eyebrow></span><h2 class="platform-infrastructure-modal-title" data-memory-title></h2></div>' +
      '    <button type="button" class="platform-infrastructure-icon-button chat-room-dialog-close" aria-label="關閉" data-close>×</button>' +
      '  </div>' +
      '  <div class="chat-room-memory-toolbar">' +
      '    <input class="platform-infrastructure-input chat-room-memory-search" placeholder="搜尋記憶內容" data-memory-search>' +
      '    <div class="platform-infrastructure-select" data-memory-filter="room">' +
      '      <button type="button" class="platform-infrastructure-select-trigger">全部聊天室</button>' +
      '      <ul class="platform-infrastructure-select-list">' +
      '        <li class="platform-infrastructure-select-option is-selected" data-value="">全部聊天室</li>' +
      ROOMS.map(function (room) { return '<li class="platform-infrastructure-select-option" data-value="' + room + '">' + room + '</li>'; }).join('') +
      '      </ul></div>' +
      '    <div class="platform-infrastructure-select" data-memory-filter="importance">' +
      '      <button type="button" class="platform-infrastructure-select-trigger">全部重要度</button>' +
      '      <ul class="platform-infrastructure-select-list">' +
      '        <li class="platform-infrastructure-select-option is-selected" data-value="0">全部重要度</li>' +
      '        <li class="platform-infrastructure-select-option" data-value="5">重要度 5</li>' +
      '        <li class="platform-infrastructure-select-option" data-value="4">重要度 4 以上</li>' +
      '        <li class="platform-infrastructure-select-option" data-value="3">重要度 3 以上</li>' +
      '      </ul></div>' +
      '    <div class="platform-infrastructure-select" data-memory-filter="sort">' +
      '      <button type="button" class="platform-infrastructure-select-trigger">排序：最後提到</button>' +
      '      <ul class="platform-infrastructure-select-list">' +
      '        <li class="platform-infrastructure-select-option is-selected" data-value="recent" data-label="排序：最後提到">最後提到</li>' +
      '        <li class="platform-infrastructure-select-option" data-value="importance" data-label="排序：重要度">重要度</li>' +
      '      </ul></div>' +
      '    <span class="chat-room-filter-toggle">只看鎖定<button type="button" class="platform-infrastructure-toggle" aria-label="只看鎖定" data-memory-locked></button></span>' +
      '    <div class="chat-room-memory-stats"><span data-memory-count></span><span data-memory-usage></span><div class="platform-infrastructure-progress"><div class="platform-infrastructure-progress-fill" data-memory-bar></div></div></div>' +
      '  </div>' +
      '  <div class="chat-room-dialog-body chat-room-memory-body" data-memory-list></div>' +
      '  <div class="chat-room-dialog-footer">' +
      '    <button type="button" class="platform-infrastructure-button platform-infrastructure-button-secondary" data-memory-add><i data-icon="plus" data-small></i>新增條目</button>' +
      '    <span class="chat-room-dialog-footer-spacer"></span>' +
      '    <span class="platform-infrastructure-feedback" data-memory-feedback></span>' +
      '    <button type="button" class="platform-infrastructure-button platform-infrastructure-button-primary" data-memory-save disabled>儲存</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(backdrop);
    window.ChatRoomDemo.renderIcons(backdrop);
    return backdrop;
  }

  var dialog = buildDialog();
  var listBox = dialog.querySelector('[data-memory-list]');

  function openFor(kind) {
    current = kind;
    var config = KINDS[kind];
    entries = makeEntries(kind);
    isDirty = false;
    dialog.querySelector('[data-memory-title]').textContent = config.title;
    dialog.querySelector('[data-memory-eyebrow]').textContent = config.eyebrow;
    dialog.querySelector('[data-memory-filter="room"]').hidden = !config.hasRoomFilter;
    dialog.querySelectorAll('[data-memory-filter="room"] [data-value]').forEach(function (option) {
      var value = option.getAttribute('data-value');
      option.hidden = value !== '' && config.rooms.indexOf(value) === -1;
    });
    dialog.querySelector('[data-memory-usage]').textContent = '約 ' + config.used.toLocaleString('en-US') + '／' + config.total.toLocaleString('en-US') + ' token';
    dialog.querySelector('[data-memory-bar]').style.width = Math.round(config.used / config.total * 100) + '%';
    resetFilters();
    updateSaveButton();
    render();
  }

  // ===== 篩選與排序 =====

  function filterValue(name) {
    var selected = dialog.querySelector('[data-memory-filter="' + name + '"] .is-selected');
    return selected ? selected.getAttribute('data-value') : '';
  }

  function resetFilters() {
    dialog.querySelector('[data-memory-search]').value = '';
    dialog.querySelector('[data-memory-locked]').classList.remove('is-on');
    dialog.querySelectorAll('[data-memory-filter]').forEach(function (select) {
      var options = select.querySelectorAll('.platform-infrastructure-select-option');
      options.forEach(function (o, index) { o.classList.toggle('is-selected', index === 0); });
      select.querySelector('.platform-infrastructure-select-trigger').textContent = options[0].getAttribute('data-label') || options[0].textContent;
    });
  }

  function visibleEntries() {
    var keyword = dialog.querySelector('[data-memory-search]').value.trim();
    var room = filterValue('room');
    var minImportance = Number(filterValue('importance')) || 0;
    var isLockedOnly = dialog.querySelector('[data-memory-locked]').classList.contains('is-on');
    var list = entries.filter(function (entry) {
      if (keyword && entry.content.indexOf(keyword) === -1) return false;
      if (room && entry.room !== room) return false;
      if (entry.importance < minImportance) return false;
      if (isLockedOnly && !entry.isLocked) return false;
      return true;
    });
    var byImportance = filterValue('sort') === 'importance';
    list.sort(function (a, b) {
      if (byImportance && a.importance !== b.importance) return b.importance - a.importance;
      return b.lastMentioned - a.lastMentioned;
    });
    return list;
  }

  // ===== 畫出清單 =====

  function render() {
    var list = visibleEntries();
    dialog.querySelector('[data-memory-count]').textContent = '顯示 ' + list.length + '／' + entries.length + ' 條';
    if (entries.length === 0) {
      listBox.innerHTML = '<div class="platform-infrastructure-empty"><p class="platform-infrastructure-empty-text">還沒有記憶</p></div>';
      return;
    }
    if (list.length === 0) {
      listBox.innerHTML = '<div class="platform-infrastructure-empty"><p class="platform-infrastructure-empty-text">沒有符合的記憶</p>' +
        '<button type="button" class="platform-infrastructure-button platform-infrastructure-button-secondary platform-infrastructure-button-small" data-memory-clear>清除篩選</button></div>';
      return;
    }
    var showRoom = KINDS[current].hasRoomFilter;
    listBox.innerHTML = list.map(function (entry) {
      var stars = '';
      for (var level = 1; level <= 5; level += 1) stars += '<button class="' + (level <= entry.importance ? 'is-on' : '') + '" data-level="' + level + '"></button>';
      return '<div class="chat-room-memory-item' + (entry.isLocked ? ' is-locked' : '') + '" data-entry="' + entry.id + '">' +
        '<span class="chat-room-importance">' + stars + '</span>' +
        '<div class="chat-room-memory-text"><input class="chat-room-memory-content" value="' + entry.content.replace(/"/g, '&quot;') + '" placeholder="輸入記憶內容">' +
        '<div class="chat-room-memory-meta">最後提到 ' + formatDate(entry.lastMentioned) + (showRoom ? '・記在「' + entry.room + '」' : '') + '</div></div>' +
        '<button type="button" class="chat-room-lock' + (entry.isLocked ? ' is-on' : '') + '" aria-label="鎖定"><i data-icon="' + (entry.isLocked ? 'lock' : 'unlock') + '"></i></button>' +
        '<button type="button" class="platform-infrastructure-icon-button" aria-label="刪除" data-memory-delete>×</button>' +
        '</div>';
    }).join('');
    window.ChatRoomDemo.renderIcons(listBox);
  }

  function findEntry(element) {
    var row = element.closest('[data-entry]');
    if (!row) return null;
    var id = Number(row.getAttribute('data-entry'));
    return entries.filter(function (e) { return e.id === id; })[0];
  }

  function markDirty() {
    isDirty = true;
    dialog.querySelector('[data-memory-feedback]').textContent = '';
    updateSaveButton();
  }

  function updateSaveButton() {
    dialog.querySelector('[data-memory-save]').disabled = !isDirty;
  }

  // ===== 事件 =====

  // 開視窗前先決定是哪一份記憶（capture：比 demo.js 的開視窗早一步）
  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-memory]');
    if (opener) openFor(opener.getAttribute('data-memory'));
  }, true);

  dialog.addEventListener('click', function (event) {
    var target = event.target;
    var entry = findEntry(target);

    if (target.closest('.chat-room-importance button') && entry) {
      entry.importance = Number(target.getAttribute('data-level'));
      markDirty();
    }
    if (target.closest('.chat-room-lock') && entry) {
      entry.isLocked = !entry.isLocked;
      markDirty();
      setTimeout(render, 0);
    }
    if (target.closest('[data-memory-delete]') && entry) {
      entries = entries.filter(function (e) { return e !== entry; });
      markDirty();
      render();
    }
    if (target.closest('[data-memory-add]')) {
      entries.unshift({ id: Date.now(), content: '', importance: 3, isLocked: false, room: ROOMS[0], lastMentioned: new Date(2026, 10, 27, 21, 45) });
      resetFilters();
      markDirty();
      render();
      listBox.scrollTop = 0;
      listBox.querySelector('.chat-room-memory-content').focus();
    }
    if (target.closest('[data-memory-clear]')) {
      resetFilters();
      render();
    }
    if (target.closest('[data-memory-save]')) {
      var save = target.closest('[data-memory-save]');
      save.disabled = true;
      save.innerHTML = '<span class="platform-infrastructure-spinner"></span>儲存中';
      setTimeout(function () {
        save.textContent = '儲存';
        isDirty = false;
        var feedback = dialog.querySelector('[data-memory-feedback]');
        feedback.className = 'platform-infrastructure-feedback is-success';
        feedback.textContent = '已儲存';
      }, 800);
    }
    // 選單、開關改完之後重新篩選（demo.js 先處理選中的樣式）
    if (target.closest('.chat-room-memory-toolbar')) setTimeout(render, 0);
  });

  dialog.addEventListener('input', function (event) {
    if (event.target.matches('[data-memory-search]')) {
      render();
      return;
    }
    var entry = findEntry(event.target);
    if (entry && event.target.matches('.chat-room-memory-content')) {
      entry.content = event.target.value;
      markDirty();
    }
  });

  // ?open=…,memory-dialog 時，用網址的 memory 參數決定開哪一份（預設角色）
  var params = new URLSearchParams(location.search);
  if ((params.get('open') || '').indexOf('memory-dialog') !== -1) {
    openFor(params.get('memory') || 'character');
    dialog.hidden = false;
  }
})();
