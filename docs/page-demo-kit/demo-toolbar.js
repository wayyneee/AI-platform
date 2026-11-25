/*
 * demo 切換列（全專案共用一份）
 * 位置：docs/page-demo-kit/demo-toolbar.js
 * 用法：在每個 demo HTML 的 <head> 載入
 *   <script src="../../../page-demo-kit/demo-toolbar.js" data-module="<Module>"></script>
 *
 * 功能：
 * - 依目前主題載入 public/theme/<主題>/theme.css
 * - 把 data-asset / data-asset-bg 依主題組成素材路徑，沒有圖時顯示佔位框
 * - 切換畫面狀態（data-state）和主題
 * - 網址參數：?theme=<主題> 指定主題、?state=<狀態> 指定狀態、?toolbar=0 隱藏切換列（截圖用）、
 *   ?candidate=<編號> 用 _candidates/ 裡的第 N 張候選圖預覽（挑圖時用）
 */
(function () {
  // 已有的主題清單；新增主題時加在這裡
  var THEMES = ['default'];

  var script = document.currentScript;
  var moduleName = script.getAttribute('data-module') || '';
  // 切換列在 docs/page-demo-kit/，主題在 public/theme/
  var themeRoot = new URL('../../public/theme/', script.src).href;
  var params = new URLSearchParams(location.search);

  // 讀寫瀏覽器暫存（可能被封鎖，所以都包 try/catch）
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
  }

  // 決定目前主題：網址參數 > 暫存 > default
  var theme = params.get('theme') || load('demoTheme') || 'default';
  if (THEMES.indexOf(theme) === -1) theme = 'default';

  // 載入主題變數
  var themeLink = document.createElement('link');
  themeLink.rel = 'stylesheet';
  themeLink.href = themeRoot + theme + '/theme.css';
  document.head.insertBefore(themeLink, document.head.firstChild);

  // 挑圖時：用 sd_generate.py generate 產生的候選圖代替正式素材
  var CANDIDATE_CHOICES = ['1', '2', '3'];
  var candidate = params.get('candidate');
  if (CANDIDATE_CHOICES.indexOf(candidate) === -1) candidate = null;

  function assetUrl(name) {
    if (candidate) return themeRoot + theme + '/' + moduleName + '/_candidates/' + name + '-' + candidate + '.png';
    return themeRoot + theme + '/' + moduleName + '/' + name + '.png';
  }

  // 佔位框的樣式（中性外觀，不使用主題變數）
  function placeholderStyle(el, ratio) {
    el.style.outline = '2px dashed #999';
    el.style.outlineOffset = '-2px';
    el.style.background = 'repeating-linear-gradient(45deg,#eee,#eee 10px,#e2e2e2 10px,#e2e2e2 20px)';
    if (ratio && !el.style.aspectRatio) el.style.aspectRatio = ratio.replace(':', ' / ');
  }

  function placeholderLabel(name, ratio) {
    var label = document.createElement('span');
    label.textContent = name + (ratio ? '（' + ratio + '）' : '');
    label.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:12px/1.4 system-ui,sans-serif;color:#555;text-align:center;padding:4px;pointer-events:none;';
    return label;
  }

  // 圖片素材
  function resolveImg(img) {
    var name = img.getAttribute('data-asset');
    var ratio = img.getAttribute('data-ratio');
    img.addEventListener('error', function () {
      var box = document.createElement('div');
      box.className = img.className;
      box.setAttribute('data-asset-placeholder', name);
      box.style.position = 'relative';
      // 尺寸以 page.css 的 class 為準；只有 img 自帶 width 屬性時才沿用
      if (img.getAttribute('width')) box.style.width = img.getAttribute('width') + 'px';
      placeholderStyle(box, ratio);
      box.appendChild(placeholderLabel(name, ratio));
      img.replaceWith(box);
    }, { once: true });
    img.src = assetUrl(name);
  }

  // 背景素材
  function resolveBg(el) {
    var name = el.getAttribute('data-asset-bg');
    var ratio = el.getAttribute('data-ratio');
    var url = assetUrl(name);
    var probe = new Image();
    probe.onload = function () {
      el.style.backgroundImage = 'url("' + url + '")';
    };
    probe.onerror = function () {
      el.setAttribute('data-asset-placeholder', name);
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      // 背景素材的尺寸由 page.css 決定，不套用比例，避免改變版面
      placeholderStyle(el, null);
      el.appendChild(placeholderLabel(name, ratio));
    };
    probe.src = url;
  }

  // 收集頁面上出現的狀態（依出現順序）
  function collectStates() {
    var list = [];
    document.querySelectorAll('[data-state]').forEach(function (el) {
      var s = el.getAttribute('data-state');
      if (list.indexOf(s) === -1) list.push(s);
    });
    return list;
  }

  function applyState(state) {
    document.querySelectorAll('[data-state]').forEach(function (el) {
      el.style.display = el.getAttribute('data-state') === state ? '' : 'none';
    });
  }

  // 主題不是 default 時，連到其他 demo 畫面的連結帶上主題參數（暫存被封鎖時也能保持主題）
  function keepThemeOnLinks() {
    if (theme === 'default') return;
    document.querySelectorAll('a[href$=".html"]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^[a-z]+:/i.test(href)) return;
      a.setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + 'theme=' + encodeURIComponent(theme));
    });
  }

  function buildToolbar(states, current) {
    var bar = document.createElement('div');
    bar.setAttribute('data-demo-toolbar', '');
    bar.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#222;color:#fff;' +
      'font:12px/1.4 system-ui,sans-serif;border-radius:8px;padding:8px 10px;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
      'max-width:calc(100vw - 24px);';

    var body = document.createElement('div');

    function row(labelText) {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:2px 0;';
      var l = document.createElement('span');
      l.textContent = labelText;
      l.style.marginRight = '4px';
      r.appendChild(l);
      body.appendChild(r);
      return r;
    }

    // 狀態切換
    if (states.length > 0) {
      var stateRow = row('狀態：');
      var buttons = [];
      states.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = s;
        b.style.cssText = 'font:inherit;border:0;border-radius:4px;padding:2px 8px;cursor:pointer;';
        b.addEventListener('click', function () {
          applyState(s);
          paint(s);
        });
        buttons.push(b);
        stateRow.appendChild(b);
      });
      function paint(active) {
        buttons.forEach(function (b) {
          var on = b.textContent === active;
          b.style.background = on ? '#4a8cff' : '#444';
          b.style.color = '#fff';
        });
      }
      paint(current);
    }

    // 主題切換
    var themeRow = row('主題：');
    var select = document.createElement('select');
    select.style.cssText = 'font:inherit;';
    THEMES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      if (t === theme) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      save('demoTheme', select.value);
      params.set('theme', select.value);
      location.search = params.toString();
    });
    themeRow.appendChild(select);

    // 候選圖預覽：正式素材、或第 N 張候選圖
    var candidateRow = row('素材：');
    [null].concat(CANDIDATE_CHOICES).forEach(function (choice) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = choice ? '候選 ' + choice : '正式';
      var isOn = choice === candidate;
      b.style.cssText = 'font:inherit;border:0;border-radius:4px;padding:2px 8px;cursor:pointer;color:#fff;' +
        'background:' + (isOn ? '#4a8cff' : '#444') + ';';
      b.addEventListener('click', function () {
        if (choice) params.set('candidate', choice); else params.delete('candidate');
        location.search = params.toString();
      });
      candidateRow.appendChild(b);
    });

    // 收合按鈕
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = '－';
    toggle.title = '收合 / 展開';
    toggle.style.cssText = 'float:right;font:inherit;border:0;background:transparent;color:#fff;cursor:pointer;margin-left:8px;';
    toggle.addEventListener('click', function () {
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '－' : '＋';
    });

    bar.appendChild(toggle);
    bar.appendChild(body);
    document.body.appendChild(bar);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (theme !== 'default' || params.get('theme')) save('demoTheme', theme);

    document.querySelectorAll('img[data-asset]').forEach(resolveImg);
    document.querySelectorAll('[data-asset-bg]').forEach(resolveBg);

    var states = collectStates();
    var current = params.get('state');
    if (states.indexOf(current) === -1) current = states.indexOf('normal') !== -1 ? 'normal' : states[0];
    if (current) applyState(current);

    keepThemeOnLinks();

    if (params.get('toolbar') !== '0') buildToolbar(states, current);
  });
})();
