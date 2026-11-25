/*
 * 新增模型視窗（AddModelDialog）的假互動：四步表單（供應商 → 連線 → 模型 → 名稱與價格）、偵測、測試、儲存、關閉前確認。
 * 視窗的外框寫在 api-settings.html（插圖要由切換列載入），這裡只畫各步驟的內容。只是畫面草稿，不接後端。
 */
(function () {
  'use strict';

  var PREFIX = 'platform-infrastructure-';
  var PLACEHOLDER = '-- 請選擇 --';
  var FORGE_DEFAULT_ADDRESS = 'http://127.0.0.1:7860';
  var DETECT_DELAY = 900;
  var TEST_DELAY = 900;
  var SAVE_DELAY = 800;

  // ===== 假資料 =====

  var PROVIDER_NAMES = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', grok: 'Grok', openrouter: 'OpenRouter', forge: 'Forge' };
  var TYPE_LABELS = { llm: 'LLM', image: '圖片', video: '影片', audio: '語音' };
  var PRICE_UNITS = { image: '每張', video: '每秒', audio: '每 100 萬字' };

  // 每個類型有哪些供應商（spec：OpenAI、Gemini、Claude 只有 LLM；Forge 只有圖片）
  var TYPE_PROVIDERS = {
    llm: ['openai', 'gemini', 'claude', 'grok', 'openrouter'],
    image: ['grok', 'openrouter', 'forge'],
    video: ['grok', 'openrouter'],
    audio: ['grok', 'openrouter']
  };

  // 抓得到價格的：OpenRouter、Grok 的 LLM（spec）
  var AUTO_PRICE_PROVIDERS = ['openrouter', 'grok'];

  // 偵測結果：供應商 → 類型 → 模型清單
  var DETECTED = {
    openai: {
      llm: [
        llm('gpt-4.1', 'GPT-4.1', 'OpenAI 的旗艦模型，擅長寫程式和長文件理解', ['文字', '圖片'], '1M', '32K', false),
        llm('gpt-4.1-mini', 'GPT-4.1 mini', '速度快、價格低，適合日常對話', ['文字', '圖片'], '1M', '32K', false),
        llm('o4-mini', 'o4-mini', '會先思考再回答，適合數學與推理', ['文字', '圖片'], '200K', '100K', true)
      ]
    },
    gemini: {
      llm: [
        llm('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Google 最強的模型，支援超長上下文', ['文字', '圖片', '影片', '音訊'], '1M', '64K', true),
        llm('gemini-2.5-flash', 'Gemini 2.5 Flash', '速度和品質平衡', ['文字', '圖片', '影片', '音訊'], '1M', '64K', true)
      ]
    },
    claude: {
      llm: [
        llm('claude-opus-4-1', 'Claude Opus 4.1', 'Anthropic 最強的模型，適合複雜的長篇寫作', ['文字', '圖片'], '200K', '32K', true),
        llm('claude-sonnet-4-5', 'Claude Sonnet 4.5', '品質和速度平衡，寫作與對話都很穩', ['文字', '圖片'], '200K', '64K', true),
        llm('claude-haiku-4-5', 'Claude Haiku 4.5', '最快、最便宜的 Claude', ['文字', '圖片'], '200K', '64K', true)
      ]
    },
    grok: {
      llm: [
        llm('grok-4', 'Grok 4', 'xAI 的旗艦推理模型', ['文字', '圖片'], '256K', '', true, { input: 3, output: 15 }),
        llm('grok-4-fast', 'Grok 4 Fast', '速度快、上下文長', ['文字', '圖片'], '2M', '', true, { input: 0.2, output: 0.5 }),
        llm('grok-3-mini', 'Grok 3 Mini', '輕量的思考模型', ['文字'], '131K', '', true, { input: 0.3, output: 0.5 })
      ],
      image: [media('grok-2-image', 'Grok 2 Image', '依文字生成圖片', ['文字'], ['圖片'])],
      video: [media('grok-imagine-video', 'Grok Imagine Video', '依文字或圖片生成短影片', ['文字', '圖片'], ['影片'])],
      audio: [media('grok-tts', 'Grok TTS', '把文字念成語音，有多種聲音可選', ['文字'], ['語音'])]
    },
    openrouter: {
      llm: [
        llm('anthropic/claude-sonnet-4.5', 'Anthropic: Claude Sonnet 4.5', '經由 OpenRouter 使用 Claude Sonnet 4.5', ['文字', '圖片'], '1M', '64K', true, { input: 3, output: 15 }),
        llm('deepseek/deepseek-chat-v3.1', 'DeepSeek: DeepSeek V3.1', '開源的大型模型，價格很低', ['文字'], '164K', '', true, { input: 0.25, output: 1 }),
        llm('google/gemini-2.5-pro', 'Google: Gemini 2.5 Pro', '經由 OpenRouter 使用 Gemini 2.5 Pro', ['文字', '圖片', '音訊'], '1M', '66K', true, { input: 1.25, output: 10 }),
        llm('meta-llama/llama-4-maverick', 'Meta: Llama 4 Maverick', 'Meta 的開源多模態模型', ['文字', '圖片'], '1M', '16K', false, { input: 0.15, output: 0.6 }),
        llm('qwen/qwen3-235b-a22b', 'Qwen: Qwen3 235B A22B', '阿里巴巴的開源模型，中文能力好', ['文字'], '131K', '8K', true, { input: 0.13, output: 0.6 })
      ],
      image: [
        media('google/gemini-2.5-flash-image', 'Google: Nano Banana', '可以生成、修改圖片', ['文字', '圖片'], ['圖片', '文字']),
        media('openai/gpt-image-1', 'OpenAI: GPT Image 1', '依文字生成圖片，擅長畫出文字', ['文字', '圖片'], ['圖片'])
      ],
      video: [media('google/veo-3', 'Google: Veo 3', '生成有聲音的短影片', ['文字', '圖片'], ['影片'])],
      audio: [media('openai/gpt-4o-mini-tts', 'OpenAI: GPT-4o mini TTS', '把文字念成語音', ['文字'], ['語音'])]
    },
    forge: {
      image: [
        media('waiIllustriousSDXL_v150', 'waiIllustriousSDXL_v150', '本機的模型檔（SDXL）', ['文字'], ['圖片']),
        media('animagineXL_v40', 'animagineXL_v40', '本機的模型檔（SDXL）', ['文字'], ['圖片'])
      ]
    }
  };

  // ===== 視窗狀態 =====

  var dialog;
  var options;   // 開啟時由畫面傳入：類型、已儲存的 key、儲存後要做什麼
  var state;
  var isConfirming = false;

  document.addEventListener('DOMContentLoaded', function () {
    dialog = document.getElementById('add-model-dialog');
    if (!dialog) return;
    dialog.querySelector('[data-dialog-close]').addEventListener('click', requestClose);
    dialog.querySelector('[data-dialog-test]').addEventListener('click', runTest);
    dialog.querySelector('[data-dialog-save]').addEventListener('click', save);
    dialog.addEventListener('change', onSelectChange);
    dialog.addEventListener('input', onInput);
    dialog.addEventListener('click', onDetectClick);
    document.addEventListener('keydown', onEsc);
  });

  window.AddModelDialog = {
    open: open,
    isDirty: isDirty
  };

  // ===== 開啟與關閉 =====

  function open(config) {
    options = config;
    state = emptyState();
    dialog.querySelector('[data-dialog-type]').textContent = TYPE_LABELS[config.type];
    renderAll();
    dialog.hidden = false;
    dialog.querySelector('.' + PREFIX + 'select-trigger').focus();
  }

  function emptyState() {
    return {
      provider: '', keyId: '', address: '',
      detect: 'idle', detectError: '',       // idle、loading、done、failed
      modelId: '', name: '', prices: {}, autoPrices: {}, invalidPrices: {},
      test: 'none',                           // none、running、success、failed
      isSaving: false
    };
  }

  function close() {
    dialog.hidden = true;
    state = emptyState();
  }

  // 有未儲存的修改時先詢問；連按兩次 X 只出現一個確認視窗
  function requestClose() {
    if (isConfirming || state.isSaving) return;
    if (!isDirty()) {
      close();
      return;
    }
    isConfirming = true;
    window.PlatformDemo.showConfirm({
      title: '尚未儲存',
      message: '修改還沒儲存，確定不儲存並離開嗎？',
      confirmText: '不儲存並離開',
      isDanger: true
    }).then(function (isConfirmed) {
      isConfirming = false;
      if (isConfirmed) close();
    });
  }

  // 確認視窗開著時，Esc 只關掉確認視窗（確認視窗在捕獲階段就攔下了）
  function onEsc(event) {
    if (event.key !== 'Escape' || dialog.hidden) return;
    requestClose();
  }

  // 選了供應商就算有修改；選回「-- 請選擇 --」等於回到剛打開的樣子
  function isDirty() {
    return !!dialog && !dialog.hidden && !!state.provider;
  }

  // ===== 每一步的操作 =====

  function onSelectChange(event) {
    var field = event.target.getAttribute && event.target.getAttribute('data-dialog-field');
    if (!field) return;
    var value = event.target.getAttribute('data-value');
    if (field === 'provider') chooseProvider(value);
    if (field === 'key') chooseKey(value);
    if (field === 'model') chooseModel(value);
  }

  // 換供應商 → 清空後面所有步驟
  function chooseProvider(provider) {
    var next = emptyState();
    next.provider = provider;
    state = next;
    renderAll();
  }

  // 換 key → 清空模型並重新偵測；選回未選 → 清空後面的步驟
  function chooseKey(keyId) {
    state.keyId = keyId;
    clearFromModel();
    if (keyId) detect(); else renderAll();
  }

  function chooseModel(modelId) {
    state.modelId = modelId;
    state.test = 'none';
    state.prices = {};
    state.autoPrices = {};
    state.invalidPrices = {};
    var model = findModel(modelId);
    state.name = model ? model.displayName : '';
    if (model && model.price && isAutoPriceProvider()) {
      Object.keys(model.price).forEach(function (field) {
        state.prices[field] = String(model.price[field]);
        state.autoPrices[field] = String(model.price[field]);
      });
    }
    renderAll();
  }

  function onInput(event) {
    var field = event.target.getAttribute('data-dialog-input');
    if (!field) return;
    if (field === 'address') {
      // 換位址 → 清空模型，要重新按偵測
      state.address = event.target.value.trim();
      clearFromModel();
      // 只重畫後面的步驟，位址輸入框不重畫（避免游標跳掉）；舊的連線錯誤拿掉
      var oldError = event.target.closest('[data-step-control]').querySelector('.' + PREFIX + 'row-error');
      if (oldError) oldError.remove();
      renderSteps(['model', 'details']);
      refreshDetectButton();
    } else if (field === 'name') {
      state.name = event.target.value;
      toggleInvalid(event.target, !state.name.trim());
    } else {
      updatePrice(field, event.target);
    }
    refreshFooter();
  }

  // 價格可以修改；改過就不再標示「已自動帶入」；不能是負數
  function updatePrice(field, input) {
    state.prices[field] = input.value;
    var isInvalid = input.value !== '' && !(Number(input.value) >= 0);
    state.invalidPrices[field] = isInvalid;
    toggleInvalid(input, isInvalid);
    var tag = input.closest('[data-price-field]').querySelector('[data-auto-tag]');
    if (tag) tag.hidden = state.prices[field] !== state.autoPrices[field];
    var error = input.closest('[data-price-field]').querySelector('[data-price-error]');
    error.hidden = !isInvalid;
  }

  function onDetectClick(event) {
    if (event.target.closest('[data-dialog-detect]')) detect();
  }

  // 偵測：列出可用的模型；Forge 沒有啟動時提示
  function detect() {
    state.detect = 'loading';
    renderSteps(['connection', 'model', 'details']);
    refreshFooter();
    var detectedFor = settingsKey();
    setTimeout(function () {
      // 等待期間換了供應商、key 或位址，這次的結果就不用了
      if (dialog.hidden || detectedFor !== settingsKey()) return;
      if (state.provider === 'forge' && state.address !== FORGE_DEFAULT_ADDRESS) {
        state.detect = 'failed';
        // 直接寫在位址下方，不另外跳錯誤訊息（同一件事只提示一次）
        state.detectError = '連不到 Forge，請先啟動 Forge（需加上 --api）或改用 API';
      } else {
        state.detect = 'done';
      }
      renderAll();
    }, DETECT_DELAY);
  }

  // ===== 測試與儲存 =====

  // 用目前的設定測試；測試成功後才能儲存
  function runTest() {
    var button = dialog.querySelector('[data-dialog-test]');
    state.test = 'running';
    setBusy(button, '測試中');
    setTestFeedback('', '');
    refreshFooter();
    var testedFor = settingsKey() + '|' + state.modelId;
    setTimeout(function () {
      clearBusy(button, '測試');
      // 測試期間改了供應商、連線或模型，這次的結果就不算
      if (dialog.hidden || testedFor !== settingsKey() + '|' + state.modelId) {
        refreshFooter();
        return;
      }
      // 假資料：OpenAI 的 key 是無效的，用來看測試失敗的樣子
      if (state.provider === 'openai') {
        state.test = 'failed';
        setTestFeedback('is-danger', '測試失敗');
        window.PlatformDemo.showError({
          plain: 'API key 無效，請確認 key 是否正確',
          source: 'PlatformInfrastructure／testModel（代碼：MODEL_KEY_INVALID）'
        });
      } else {
        state.test = 'success';
        setTestFeedback('is-success', '測試成功');
      }
      refreshFooter();
    }, TEST_DELAY);
  }

  // 儲存成功後直接關閉（不詢問），提示並重新載入模型列表
  function save() {
    var button = dialog.querySelector('[data-dialog-save]');
    state.isSaving = true;
    setBusy(button, '儲存中');
    dialog.querySelector('[data-dialog-test]').disabled = true;
    setTimeout(function () {
      clearBusy(button, '儲存');
      var model = findModel(state.modelId);
      var saved = {
        type: options.type,
        name: state.name.trim(),
        modelName: model.id,
        provider: state.provider,
        keyId: state.keyId,
        address: state.provider === 'forge' ? state.address : '',
        price: priceForSave(),
        isTestFailing: state.provider === 'openai'
      };
      close();
      options.onSaved(saved);
      window.PlatformDemo.showToast('success', '已新增 ' + saved.name);
    }, SAVE_DELAY);
  }

  function priceForSave() {
    var fields = options.type === 'llm' ? ['input', 'output'] : ['unit'];
    var price = {};
    var hasAny = false;
    fields.forEach(function (field) {
      if (state.prices[field] === undefined || state.prices[field] === '') return;
      price[field] = Number(state.prices[field]);
      hasAny = true;
    });
    // 只填了一部分時，沒填的當 0
    if (!hasAny) return null;
    fields.forEach(function (field) { if (price[field] === undefined) price[field] = 0; });
    return price;
  }

  // ===== 畫面 =====

  function renderAll() {
    renderSteps(['provider', 'connection', 'model', 'details']);
    setTestFeedback('', '');
    if (state.test === 'success') setTestFeedback('is-success', '測試成功');
    refreshFooter();
  }

  function renderSteps(names) {
    names.forEach(function (name) {
      var step = dialog.querySelector('[data-step="' + name + '"]');
      var isEnabled = isStepEnabled(name);
      step.classList.toggle('is-disabled', !isEnabled);
      step.classList.toggle('is-done', isStepDone(name));
      var control = step.querySelector('[data-step-control]');
      control.innerHTML = isEnabled ? STEP_RENDERERS[name]() : '<div class="' + PREFIX + 'hint">' + DISABLED_HINTS[name] + '</div>';
      control.querySelectorAll('[data-select]').forEach(window.PlatformDemo.setupSelect);
    });
  }

  var DISABLED_HINTS = {
    provider: '',
    connection: '先選供應商',
    model: '先完成連線設定',
    details: '先選模型'
  };

  // 前一步完成後下一步才能操作
  function isStepEnabled(name) {
    if (name === 'provider') return true;
    if (name === 'connection') return !!state.provider;
    if (name === 'model') return isStepDone('connection');
    return !!state.modelId;
  }

  function isStepDone(name) {
    if (name === 'provider') return !!state.provider;
    // Forge 按過偵測才算完成（失敗時模型那一步會提示先連上）
    if (name === 'connection') return state.provider === 'forge' ? state.detect !== 'idle' : !!state.keyId;
    if (name === 'model') return !!state.modelId;
    return state.test === 'success';
  }

  var STEP_RENDERERS = {
    provider: function () {
      var items = TYPE_PROVIDERS[options.type].map(function (p) { return { value: p, label: PROVIDER_NAMES[p] }; });
      return selectHtml('provider', items, state.provider, '搜尋供應商');
    },

    connection: function () {
      if (state.provider === 'forge') {
        return '<div class="' + PREFIX + 'add-model-inline">' +
          '<input class="' + PREFIX + 'input" data-dialog-input="address" placeholder="' + FORGE_DEFAULT_ADDRESS + '" value="' + escapeAttr(state.address) + '">' +
          '<button type="button" class="' + PREFIX + 'button ' + PREFIX + 'button-secondary" data-dialog-detect' +
          (state.address && state.detect !== 'loading' ? '' : ' disabled') + '>偵測</button>' +
          '</div>' +
          (state.detect === 'failed' ? '<div class="' + PREFIX + 'row-error">' + state.detectError + '</div>' : '') +
          '<div class="' + PREFIX + 'hint">本機 Forge 的位址，啟動時要加上 --api</div>';
      }
      var keys = options.keys.filter(function (k) { return k.provider === state.provider; });
      if (keys.length === 0) {
        return '<div class="' + PREFIX + 'row-error">請先到 API key 分頁新增 key</div>';
      }
      var items = keys.map(function (k) { return { value: k.id, label: k.name, hint: k.mask }; });
      return selectHtml('key', items, state.keyId, '');
    },

    model: function () {
      if (state.detect === 'loading') {
        return '<div class="' + PREFIX + 'add-model-detecting"><span class="' + PREFIX + 'spinner"></span>偵測中…</div>';
      }
      if (state.detect === 'failed') return '<div class="' + PREFIX + 'hint">連上之後才能列出模型</div>';
      var models = detectedModels();
      var items = models.map(function (m) { return { value: m.id, label: m.displayName, hint: capabilitySummary(m) }; });
      var html = selectHtml('model', items, state.modelId, '搜尋模型') +
        '<div class="' + PREFIX + 'hint">偵測到 ' + models.length + ' 個可用模型</div>';
      var model = findModel(state.modelId);
      return model ? html + modelInfoHtml(model) : html;
    },

    details: function () {
      var html = '<label class="' + PREFIX + 'add-model-label">顯示名稱</label>' +
        '<input class="' + PREFIX + 'input' + (state.name.trim() ? '' : ' is-invalid') + '" data-dialog-input="name" value="' + escapeAttr(state.name) + '">' +
        '<div class="' + PREFIX + 'add-model-prices">';
      if (options.type === 'llm') {
        html += priceFieldHtml('input', '輸入價格（每 100 萬 token）') + priceFieldHtml('output', '輸出價格（每 100 萬 token）');
      } else {
        html += priceFieldHtml('unit', '價格（' + PRICE_UNITS[options.type] + '）');
      }
      return html + '</div><div class="' + PREFIX + 'hint">沒填價格時只統計用量，不計算花費</div>';
    }
  };

  function priceFieldHtml(field, label) {
    var value = state.prices[field] || '';
    var isAuto = state.autoPrices[field] !== undefined && value === state.autoPrices[field];
    return '<div class="' + PREFIX + 'add-model-price" data-price-field>' +
      '<label class="' + PREFIX + 'add-model-label">' + label +
      ' <span class="' + PREFIX + 'badge is-success" data-auto-tag' + (isAuto ? '' : ' hidden') + '>已自動帶入</span></label>' +
      '<div class="' + PREFIX + 'add-model-money">' +
      '<span class="' + PREFIX + 'add-model-money-sign">$</span>' +
      '<input class="' + PREFIX + 'input' + (state.invalidPrices[field] ? ' is-invalid' : '') + '" type="number" min="0" step="0.01" data-dialog-input="' + field + '" placeholder="未設定" value="' + escapeAttr(value) + '">' +
      '</div>' +
      '<div class="' + PREFIX + 'field-error" data-price-error' + (state.invalidPrices[field] ? '' : ' hidden') + '>價格不能是負數</div>' +
      '</div>';
  }

  // 模型資訊卡：有資料才顯示
  function modelInfoHtml(model) {
    var rows = [];
    if (model.input) rows.push(['可輸入', model.input.join('、')]);
    if (model.output) rows.push(['可輸出', model.output.join('、')]);
    if (model.inputLimit) rows.push(['輸入上限', model.inputLimit + ' token']);
    if (model.outputLimit) rows.push(['輸出上限', model.outputLimit + ' token']);
    if (model.thinking !== undefined) rows.push(['思考', model.thinking ? '支援' : '不支援']);
    return '<div class="' + PREFIX + 'add-model-info">' +
      (model.description ? '<p class="' + PREFIX + 'add-model-info-description">' + escapeHtml(model.description) + '</p>' : '') +
      '<dl class="' + PREFIX + 'add-model-info-list">' +
      rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') +
      '</dl></div>';
  }

  // 能力摘要，例如「輸入上限 128K・輸出上限 16K・支援思考」
  function capabilitySummary(model) {
    var parts = [];
    if (model.inputLimit) parts.push('輸入上限 ' + model.inputLimit);
    if (model.outputLimit) parts.push('輸出上限 ' + model.outputLimit);
    if (model.thinking) parts.push('支援思考');
    if (!model.inputLimit && model.input) parts.push('輸入：' + model.input.join('、'));
    return parts.join('・');
  }

  // 可搜尋的下拉選單（searchText 為空時不放搜尋框）
  function selectHtml(field, items, value, searchText) {
    var search = searchText
      ? '<li class="' + PREFIX + 'select-search-item"><input class="' + PREFIX + 'input ' + PREFIX + 'select-search" placeholder="' + searchText + '"></li>'
      : '';
    var list = items.map(function (item) {
      return '<li class="' + PREFIX + 'select-option" data-value="' + escapeAttr(item.value) + '">' + escapeHtml(item.label) +
        (item.hint ? '<span class="' + PREFIX + 'select-option-hint">' + escapeHtml(item.hint) + '</span>' : '') + '</li>';
    }).join('');
    return '<div class="' + PREFIX + 'select" data-select data-dialog-field="' + field + '" data-placeholder="' + PLACEHOLDER + '" data-value="' + escapeAttr(value) + '">' +
      '<button type="button" class="' + PREFIX + 'select-trigger"></button>' +
      '<ul class="' + PREFIX + 'select-list">' + search +
      '<li class="' + PREFIX + 'select-option" data-value="">' + PLACEHOLDER + '</li>' + list +
      '</ul></div>';
  }

  // 測試：選好模型才能按；儲存：測試成功、名稱有填、價格沒有錯才能按
  function refreshFooter() {
    var testButton = dialog.querySelector('[data-dialog-test]');
    var saveButton = dialog.querySelector('[data-dialog-save]');
    if (state.test !== 'running') testButton.disabled = !state.modelId || state.isSaving;
    var hasInvalidPrice = Object.keys(state.invalidPrices).some(function (f) { return state.invalidPrices[f]; });
    if (!state.isSaving) saveButton.disabled = state.test !== 'success' || !state.name.trim() || hasInvalidPrice;
  }

  function refreshDetectButton() {
    var button = dialog.querySelector('[data-dialog-detect]');
    if (button) button.disabled = !state.address;
  }

  // ===== 輔助 =====

  function clearFromModel() {
    state.detect = 'idle';
    state.detectError = '';
    state.modelId = '';
    state.name = '';
    state.prices = {};
    state.autoPrices = {};
    state.invalidPrices = {};
    state.test = 'none';
  }

  // 目前的供應商與連線設定，用來判斷等待中的結果是不是已經過時
  function settingsKey() {
    return state.provider + '|' + state.keyId + '|' + state.address;
  }

  function detectedModels() {
    return (DETECTED[state.provider] && DETECTED[state.provider][options.type]) || [];
  }

  function findModel(id) {
    return detectedModels().filter(function (m) { return m.id === id; })[0];
  }

  function isAutoPriceProvider() {
    return options.type === 'llm' && AUTO_PRICE_PROVIDERS.indexOf(state.provider) !== -1;
  }

  function setTestFeedback(type, text) {
    var feedback = dialog.querySelector('[data-test-feedback]');
    feedback.className = PREFIX + 'feedback' + (type ? ' ' + type : '');
    feedback.textContent = text;
  }

  function toggleInvalid(input, isInvalid) {
    input.classList.toggle('is-invalid', isInvalid);
  }

  function setBusy(button, text) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.innerHTML = '<span class="' + PREFIX + 'spinner"></span>' + text;
  }

  function clearBusy(button, text) {
    button.classList.remove('is-busy');
    button.textContent = text;
  }

  function llm(id, displayName, description, input, inputLimit, outputLimit, thinking, price) {
    return { id: id, displayName: displayName, description: description, input: input, output: ['文字'], inputLimit: inputLimit, outputLimit: outputLimit, thinking: thinking, price: price };
  }

  function media(id, displayName, description, input, output) {
    return { id: id, displayName: displayName, description: description, input: input, output: output };
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(String(text)).replace(/"/g, '&quot;');
  }
})();
