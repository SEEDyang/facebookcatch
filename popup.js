const DEFAULT_EXCLUDE_KEYWORDS = [
  "fork",
  "forks",
  "seal",
  "seals",
  "bushing",
  "bushings",
  "dust seal",
  "wheel",
  "rim",
  "tire",
  "tyre",
  "headers",
  "header",
  "exhaust",
  "muffler",
  "fairing",
  "plastics",
  "tail",
  "seat",
  "tank",
  "parts",
  "part",
  "oem",
  "stock exhaust",
  "front wheel",
  "rear wheel",
  "bracket",
  "mirror",
  "windshield",
  "lever",
  "levers",
  "pegs",
  "sprocket",
  "chain",
  "brake pads",
  "rotor",
  "rotors",
  "caliper",
  "clutch",
  "cover",
  "engine cover"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  keywords: [
    "CBR600RR",
    "CBR 600RR",
    "CBR 600 RR",
    "600RR",
    "CBR600",
    "ZX6R",
    "ZX-6R",
    "636"
  ],
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
  minPrice: null,
  maxPrice: null,
  minYear: null,
  maxYear: null,
  scanIntervalSec: 60,
  soundEnabled: true,
  desktopNotificationsEnabled: true,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  iftttKey: "",
  iftttEventName: "",
  autoRefreshEnabled: false,
  autoRefreshMinutes: 7,
  autoRefreshJitterSeconds: 45,
  autoScrollToMatch: true,
  copyMessageTemplate:
    "你好，请问这台 {{title}} 还在吗？我有兴趣。",
  dedupeHours: 12
};

const DEFAULT_RUNTIME_STATE = {
  stats: {
    notificationsSent: 0,
    discordAlertsSent: 0,
    discordAlertsFailed: 0,
    lastAlertedAt: 0,
    lastAlertedTitle: "",
    lastDiscordStatus: "",
    lastDiscordError: "",
    lastScanAt: 0,
    lastScanPage: "",
    lastScanListingsSeen: 0,
    lastScanMatchesFound: 0,
    lastScanPossibleMatches: 0,
    lastScanIgnoredListings: 0
  }
};

const formElements = {
  enabled: document.getElementById("enabled"),
  keywords: document.getElementById("keywords"),
  excludeKeywords: document.getElementById("excludeKeywords"),
  minPrice: document.getElementById("minPrice"),
  maxPrice: document.getElementById("maxPrice"),
  minYear: document.getElementById("minYear"),
  maxYear: document.getElementById("maxYear"),
  scanIntervalSec: document.getElementById("scanIntervalSec"),
  dedupeHours: document.getElementById("dedupeHours"),
  soundEnabled: document.getElementById("soundEnabled"),
  desktopNotificationsEnabled: document.getElementById("desktopNotificationsEnabled"),
  autoScrollToMatch: document.getElementById("autoScrollToMatch"),
  copyMessageTemplate: document.getElementById("copyMessageTemplate"),
  autoRefreshEnabled: document.getElementById("autoRefreshEnabled"),
  autoRefreshMinutes: document.getElementById("autoRefreshMinutes"),
  autoRefreshJitterSeconds: document.getElementById("autoRefreshJitterSeconds"),
  discordWebhookUrl: document.getElementById("discordWebhookUrl"),
  telegramBotToken: document.getElementById("telegramBotToken"),
  telegramChatId: document.getElementById("telegramChatId"),
  iftttEventName: document.getElementById("iftttEventName"),
  iftttKey: document.getElementById("iftttKey")
};

const statusNodes = {
  lastScanAt: document.getElementById("lastScanAt"),
  lastScanPage: document.getElementById("lastScanPage"),
  lastScanListingsSeen: document.getElementById("lastScanListingsSeen"),
  lastScanMatchesFound: document.getElementById("lastScanMatchesFound"),
  lastScanPossibleMatches: document.getElementById("lastScanPossibleMatches"),
  lastScanIgnoredListings: document.getElementById("lastScanIgnoredListings"),
  notificationsSent: document.getElementById("notificationsSent"),
  discordAlertsSent: document.getElementById("discordAlertsSent"),
  discordAlertsFailed: document.getElementById("discordAlertsFailed"),
  lastAlertedTitle: document.getElementById("lastAlertedTitle"),
  lastDiscordStatus: document.getElementById("lastDiscordStatus"),
  lastDiscordError: document.getElementById("lastDiscordError")
};

const statusMessage = document.getElementById("statusMessage");
const extensionApisAvailable = Boolean(
  globalThis.chrome?.runtime?.id &&
    globalThis.chrome?.storage?.sync &&
    globalThis.chrome?.storage?.local
);

document.addEventListener("DOMContentLoaded", () => {
  if (!extensionApisAvailable) {
    disableStandalonePreview();
    setStatus(
      "这是源码预览页，不是 Chrome 扩展弹窗。请在 Chrome 工具栏里点扩展图标后再测试 Discord。",
      true
    );
    return;
  }

  document.getElementById("saveButton").addEventListener("click", saveSettings);
  document.getElementById("scanNowButton").addEventListener("click", scanNow);
  document
    .getElementById("testNotificationButton")
    .addEventListener("click", testNotification);
  document
    .getElementById("clearAlertHistoryButton")
    .addEventListener("click", clearAlertHistory);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.stats) {
      return;
    }
    renderRuntimeState({
      stats: changes.stats.newValue || DEFAULT_RUNTIME_STATE.stats
    });
  });

  initialize().catch((error) => {
    console.error("Popup initialization failed", error);
    setStatus(error?.message || "扩展弹窗初始化失败。", true);
  });
});

async function initialize() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = normalizeSettings(stored);
  populateForm(settings);

  const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
  renderRuntimeState(runtimeState);
}

function normalizeSettings(settings) {
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...settings,
    keywords: ensureArray(settings.keywords, DEFAULT_SETTINGS.keywords),
    excludeKeywords: mergeKeywordDefaults(
      settings.excludeKeywords,
      DEFAULT_SETTINGS.excludeKeywords
    )
  };

  normalized.minPrice = normalizeOptionalNumber(settings.minPrice);
  normalized.maxPrice = normalizeOptionalNumber(settings.maxPrice);
  normalized.minYear = normalizeOptionalNumber(settings.minYear, true);
  normalized.maxYear = normalizeOptionalNumber(settings.maxYear, true);
  normalizeRange(normalized, "minPrice", "maxPrice");
  normalizeRange(normalized, "minYear", "maxYear");

  return normalized;
}

function ensureArray(value, fallback, fallbackWhenEmpty = false) {
  let keywords;

  if (Array.isArray(value)) {
    keywords = value.map((entry) => String(entry).trim()).filter(Boolean);
  } else if (typeof value === "string") {
    keywords = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else {
    keywords = [...fallback];
  }

  if (fallbackWhenEmpty && keywords.length === 0) {
    return [...fallback];
  }

  return keywords;
}

function mergeKeywordDefaults(value, fallback) {
  const keywords = ensureArray(value, fallback, true);
  return Array.from(
    new Set(
      [...fallback, ...keywords]
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    )
  );
}

function normalizeOptionalNumber(value, integer = false) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return integer ? Math.round(number) : number;
}

function normalizeRange(settings, minKey, maxKey) {
  if (settings[minKey] === null || settings[maxKey] === null) {
    return;
  }

  if (settings[minKey] > settings[maxKey]) {
    const minValue = settings[minKey];
    settings[minKey] = settings[maxKey];
    settings[maxKey] = minValue;
  }
}

function populateForm(settings) {
  formElements.enabled.checked = Boolean(settings.enabled);
  formElements.keywords.value = settings.keywords.join(", ");
  formElements.excludeKeywords.value = settings.excludeKeywords.join(", ");
  formElements.minPrice.value =
    settings.minPrice === null ? "" : String(settings.minPrice);
  formElements.maxPrice.value =
    settings.maxPrice === null ? "" : String(settings.maxPrice);
  formElements.minYear.value = settings.minYear === null ? "" : String(settings.minYear);
  formElements.maxYear.value = settings.maxYear === null ? "" : String(settings.maxYear);
  formElements.scanIntervalSec.value = String(settings.scanIntervalSec);
  formElements.dedupeHours.value = String(settings.dedupeHours);
  formElements.soundEnabled.checked = Boolean(settings.soundEnabled);
  formElements.desktopNotificationsEnabled.checked = Boolean(
    settings.desktopNotificationsEnabled
  );
  formElements.autoScrollToMatch.checked = Boolean(settings.autoScrollToMatch);
  formElements.copyMessageTemplate.value = settings.copyMessageTemplate;
  formElements.autoRefreshEnabled.checked = Boolean(settings.autoRefreshEnabled);
  formElements.autoRefreshMinutes.value = String(settings.autoRefreshMinutes);
  formElements.autoRefreshJitterSeconds.value = String(
    settings.autoRefreshJitterSeconds
  );
  formElements.discordWebhookUrl.value = settings.discordWebhookUrl;
  formElements.telegramBotToken.value = settings.telegramBotToken;
  formElements.telegramChatId.value = settings.telegramChatId;
  formElements.iftttEventName.value = settings.iftttEventName;
  formElements.iftttKey.value = settings.iftttKey;
}

function gatherSettings() {
  const settings = {
    enabled: formElements.enabled.checked,
    keywords: splitCommaList(formElements.keywords.value),
    excludeKeywords: splitCommaList(formElements.excludeKeywords.value),
    minPrice: readOptionalNumber(formElements.minPrice),
    maxPrice: readOptionalNumber(formElements.maxPrice),
    minYear: readOptionalNumber(formElements.minYear, true),
    maxYear: readOptionalNumber(formElements.maxYear, true),
    scanIntervalSec: Number(formElements.scanIntervalSec.value) || 60,
    dedupeHours: Number(formElements.dedupeHours.value) || 12,
    soundEnabled: formElements.soundEnabled.checked,
    desktopNotificationsEnabled: formElements.desktopNotificationsEnabled.checked,
    autoScrollToMatch: formElements.autoScrollToMatch.checked,
    copyMessageTemplate: formElements.copyMessageTemplate.value.trim(),
    autoRefreshEnabled: formElements.autoRefreshEnabled.checked,
    autoRefreshMinutes: Number(formElements.autoRefreshMinutes.value) || 7,
    autoRefreshJitterSeconds:
      Number(formElements.autoRefreshJitterSeconds.value) || 0,
    discordWebhookUrl: formElements.discordWebhookUrl.value.trim(),
    telegramBotToken: formElements.telegramBotToken.value.trim(),
    telegramChatId: formElements.telegramChatId.value.trim(),
    iftttEventName: formElements.iftttEventName.value.trim(),
    iftttKey: formElements.iftttKey.value.trim()
  };

  normalizeRange(settings, "minPrice", "maxPrice");
  normalizeRange(settings, "minYear", "maxYear");

  return settings;
}

function splitCommaList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readOptionalNumber(element, integer = false) {
  const rawValue = element.value.trim();
  if (!rawValue) {
    return null;
  }

  const number = Number(rawValue);
  if (!Number.isFinite(number)) {
    return null;
  }

  return integer ? Math.round(number) : number;
}

async function saveSettings() {
  const settings = gatherSettings();
  await chrome.storage.sync.set(settings);
  await chrome.storage.local.set({
    discordWebhookUrl: settings.discordWebhookUrl.trim()
  });
  setStatus("设置已保存。");
}

async function scanNow() {
  setStatus("正在请求扫描已打开的 Marketplace 标签页...");
  const response = await sendMessage({ type: "mmm:scanOpenTabs" });
  if (response?.ok) {
    setStatus(`已请求扫描 ${response.count || 0} 个已打开的 Marketplace 标签页。`);
    return;
  }

  setStatus(response?.error || "无法发起扫描。", true);
}

async function testNotification() {
  setStatus("正在发送测试通知...");
  const webhookUrl = formElements.discordWebhookUrl.value.trim();
  await chrome.storage.sync.set({
    discordWebhookUrl: webhookUrl
  });
  await chrome.storage.local.set({
    discordWebhookUrl: webhookUrl
  });
  const response = await sendMessage({ type: "mmm:testNotification" });
  if (response?.ok) {
    setStatus(response.message || "Discord test sent successfully");
    return;
  }

  setStatus(response?.error || "测试通知失败。", true);
}

async function clearAlertHistory() {
  setStatus("正在清空已提醒历史...");
  const response = await sendMessage({ type: "mmm:clearAlertHistory" });
  if (response?.ok) {
    const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
    renderRuntimeState(runtimeState);
    setStatus("已清空提醒历史。下一次命中会重新尝试发送。");
    return;
  }

  setStatus(response?.error || "无法清空提醒历史。", true);
}

function renderRuntimeState(runtimeState) {
  const stats = {
    ...DEFAULT_RUNTIME_STATE.stats,
    ...(runtimeState.stats || {})
  };

  statusNodes.lastScanAt.textContent = stats.lastScanAt
    ? new Date(stats.lastScanAt).toLocaleString()
    : "从未";
  statusNodes.lastScanPage.textContent = stats.lastScanPage || "还没有扫描";
  statusNodes.lastScanListingsSeen.textContent = String(stats.lastScanListingsSeen || 0);
  statusNodes.lastScanMatchesFound.textContent = String(
    stats.lastScanMatchesFound || 0
  );
  statusNodes.lastScanPossibleMatches.textContent = String(
    stats.lastScanPossibleMatches || 0
  );
  statusNodes.lastScanIgnoredListings.textContent = String(
    stats.lastScanIgnoredListings || 0
  );
  statusNodes.notificationsSent.textContent = String(stats.notificationsSent || 0);
  statusNodes.discordAlertsSent.textContent = String(stats.discordAlertsSent || 0);
  statusNodes.discordAlertsFailed.textContent = String(stats.discordAlertsFailed || 0);
  statusNodes.lastAlertedTitle.textContent = stats.lastAlertedTitle || "暂无";
  statusNodes.lastDiscordStatus.textContent = stats.lastDiscordStatus || "暂无";
  statusNodes.lastDiscordError.textContent = stats.lastDiscordError || "暂无";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = isError ? "error" : "success";
}

function disableStandalonePreview() {
  document
    .querySelectorAll("input, textarea, select, button")
    .forEach((element) => {
      element.disabled = true;
    });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}
