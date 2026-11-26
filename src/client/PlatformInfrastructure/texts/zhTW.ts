// PlatformInfrastructure 的繁體中文文字表：這是文字的基準表，其他語言的鍵必須和這裡完全相同。
// 鍵的格式：一般文字 PlatformInfrastructure.<分類>.<名稱>，錯誤說明 errors.<錯誤代碼>（conventions.md 第 9 段）。

export const platformInfrastructureTexts = {
  // ===== 外殼 =====
  'PlatformInfrastructure.app.title': 'AI platform',
  'PlatformInfrastructure.app.logoAlt': '平台標誌',
  'PlatformInfrastructure.nav.settings': '平台設定',
  'PlatformInfrastructure.nav.settingsEyebrow': 'Settings',
  'PlatformInfrastructure.nav.basicSettings': '基礎設定',
  'PlatformInfrastructure.nav.apiSettings': 'API 串接',
  'PlatformInfrastructure.nav.usageStats': '花費統計',
  'PlatformInfrastructure.contentError.title': '這個頁面發生錯誤',
  'PlatformInfrastructure.contentError.reload': '重新整理',

  // ===== log 列 =====
  'PlatformInfrastructure.logBar.empty': '目前沒有 log',
  'PlatformInfrastructure.logBar.expand': '▲ 展開',
  'PlatformInfrastructure.logBar.collapse': '▼ 收合',
  'PlatformInfrastructure.logBar.filterAll': '全部',
  'PlatformInfrastructure.logBar.limitHint': '最多保留最近 1000 筆',
  'PlatformInfrastructure.logBar.emptyLevel': '這個等級沒有 log',
  'PlatformInfrastructure.logBar.showDetail': '看細節',
  'PlatformInfrastructure.logBar.hideDetail': '收起',
  'PlatformInfrastructure.logBar.status': '狀態 {status}',
  'PlatformInfrastructure.logBar.duration': '耗時 {duration}',
  'PlatformInfrastructure.logBar.keyName': 'key：{keyName}',
  'PlatformInfrastructure.logBar.detailMessage': '訊息：{message}',
  'PlatformInfrastructure.logBar.detailDetails': '細節：{details}',
  'PlatformInfrastructure.logLevel.success': '正確',
  'PlatformInfrastructure.logLevel.warning': '警告',
  'PlatformInfrastructure.logLevel.error': '錯誤',

  // ===== 共用元件 =====
  'PlatformInfrastructure.common.loading': '讀取中…',
  'PlatformInfrastructure.common.loadFailed': '載入失敗',
  'PlatformInfrastructure.common.retry': '重試',
  'PlatformInfrastructure.common.save': '儲存',
  'PlatformInfrastructure.common.saving': '儲存中',
  'PlatformInfrastructure.common.saveFailed': '儲存失敗',
  'PlatformInfrastructure.common.close': '關閉',
  'PlatformInfrastructure.common.cancel': '取消',
  'PlatformInfrastructure.common.confirm': '確認',
  'PlatformInfrastructure.common.selectPlaceholder': '-- 請選擇 --',
  'PlatformInfrastructure.common.errorSource': '{module}／{interfaceName}（代碼：{code}）',
  // 有未儲存的修改時，任何離開方式都用這組文字詢問（conventions.md 第 9 段）
  'PlatformInfrastructure.leaveConfirm.title': '尚未儲存',
  'PlatformInfrastructure.leaveConfirm.message': '修改還沒儲存，確定不儲存並離開嗎？',
  'PlatformInfrastructure.leaveConfirm.confirm': '不儲存並離開',
  // 長時間任務的狀態
  'PlatformInfrastructure.task.queued': '排隊中',
  'PlatformInfrastructure.task.running': '處理中',
  'PlatformInfrastructure.task.completed': '完成',
  'PlatformInfrastructure.task.failed': '失敗',
  // 暫時的：API 串接、花費統計在之後的分段實作，完成時移除
  'PlatformInfrastructure.common.comingSoon': '這個頁面還在製作中',

  // ===== 語言名稱（用各語言自己的寫法） =====
  'PlatformInfrastructure.language.zh-TW': '繁體中文',

  // ===== 基礎設定 =====
  'PlatformInfrastructure.basicSettings.display': 'Settings',
  'PlatformInfrastructure.basicSettings.eyebrow': 'Basic Settings',
  'PlatformInfrastructure.basicSettings.title': '基礎設定',
  'PlatformInfrastructure.basicSettings.description': '選擇平台的主題和語言，打造你喜歡的工作空間',
  'PlatformInfrastructure.basicSettings.cardTitle': '外觀與語言',
  'PlatformInfrastructure.basicSettings.cardEyebrow': 'Appearance',
  'PlatformInfrastructure.basicSettings.theme': '主題',
  'PlatformInfrastructure.basicSettings.themeHint': '顏色、字體和畫面插圖會一起換掉',
  'PlatformInfrastructure.basicSettings.language': '語言',
  'PlatformInfrastructure.basicSettings.languageHint': '畫面上的文字會換成選擇的語言',
  'PlatformInfrastructure.basicSettings.saved': '已儲存，即將重新整理套用',

  // ===== API 串接 =====
  'PlatformInfrastructure.apiSettings.display': 'Connect',
  'PlatformInfrastructure.apiSettings.eyebrow': 'API Connection',
  'PlatformInfrastructure.apiSettings.title': 'API 串接',
  'PlatformInfrastructure.apiSettings.description': '管理 API key 和模型，讓平台連上你的 AI 夥伴',

  // ===== 花費統計 =====
  'PlatformInfrastructure.usageStats.display': 'Usage',
  'PlatformInfrastructure.usageStats.eyebrow': 'Usage & Cost',
  'PlatformInfrastructure.usageStats.title': '花費統計',
  'PlatformInfrastructure.usageStats.description':
    '依 API key 查看用量和花費，每一分錢花在哪裡都清清楚楚',

  // ===== 錯誤說明：平台共通 =====
  'errors.PLATFORM_UNREACHABLE': '無法連線到平台，請確認平台是否還在執行',
  'errors.PLATFORM_RESPONSE_INVALID': '平台回傳的資料無法解讀，請重新整理後再試',
  'errors.PLATFORM_UNEXPECTED_ERROR': '平台發生未預期的錯誤，可以在 log 查看細節',
  'errors.PLATFORM_FRONTEND_UNEXPECTED_ERROR': '畫面發生未預期的錯誤，可以在 log 查看細節',
  'errors.PLATFORM_PAGE_RENDER_FAILED': '這個頁面發生錯誤',
  'errors.PLATFORM_REQUEST_INVALID': '送出的資料格式不正確',
  'errors.PLATFORM_ROUTE_NOT_FOUND': '找不到這個功能，平台可能需要更新',
  'errors.PLATFORM_TEST_DATA_DIRECTORY_MISSING': '自動測試沒有指定資料資料夾',

  // ===== 錯誤說明：資料庫 =====
  'errors.DATABASE_OPEN_FAILED': '資料庫無法開啟，請確認 data 資料夾可以讀寫',
  'errors.DATABASE_UPGRADE_FAILED': '資料庫升級失敗，資料維持在升級前的狀態',
  'errors.DATABASE_VERSION_TOO_NEW': '資料是用比較新的平台版本建立的，請更新平台',
  'errors.DATABASE_QUERY_FAILED': '讀寫資料庫時發生問題，請稍後再試',

  // ===== 錯誤說明：主題與語言 =====
  'errors.SETTINGS_THEME_NOT_FOUND': '找不到選擇的主題',
  'errors.SETTINGS_LANGUAGE_NOT_FOUND': '平台沒有選擇的語言',

  // ===== 錯誤說明：供應商 =====
  'errors.PROVIDER_KEY_INVALID': 'API key 無效，請確認 key 是否正確',
  'errors.PROVIDER_QUOTA_EXCEEDED': '這組 key 的額度不足，請到供應商網站確認餘額或帳單',
  'errors.PROVIDER_RATE_LIMITED': '請求太頻繁，請稍後再試',
  'errors.PROVIDER_REQUEST_REFUSED': '供應商拒絕了這個請求，可以在 log 查看原因',
  'errors.PROVIDER_BAD_REQUEST': '供應商不接受這個請求，可能是模型不支援這項功能',
  'errors.PROVIDER_MODEL_NOT_FOUND': '供應商找不到這個模型，請確認模型是否還存在',
  'errors.PROVIDER_SERVER_ERROR': '供應商的服務發生錯誤，請稍後再試',
  'errors.PROVIDER_UNREACHABLE': '連不上供應商，請確認網路連線',
  'errors.PROVIDER_FORGE_NOT_RUNNING': '請先啟動 Forge（需加上 --api）或改用 API',
  'errors.PROVIDER_RESPONSE_INVALID': '供應商回傳的內容無法解讀，可以在 log 查看細節',
  'errors.PROVIDER_CANCELLED': '已取消',
  'errors.THEME_LOAD_FAILED': '主題載入失敗，已改用 default 主題',
} as const;

/** PlatformInfrastructure 的文字鍵；其他語言的文字表要有完全相同的鍵。 */
export type PlatformInfrastructureTextKey = keyof typeof platformInfrastructureTexts;
