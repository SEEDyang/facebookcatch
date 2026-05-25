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
  alertedItems: {},
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

const SCAN_ALARM_NAME = "marketplace-scan";
const REFRESH_ALARM_NAME = "marketplace-refresh";
const ALERT_RETENTION_MS = 1000 * 60 * 60 * 48;
const MAX_ALERTED_ITEMS = 500;

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults()
    .then(async () => {
      await scheduleAllAlarms();
      await requestMarketplaceScans();
    })
    .catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAllAlarms()
    .then(requestMarketplaceScans)
    .catch(console.error);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  const changedSettingKeys = Object.keys(changes);
  const schedulingKeys = new Set([
    "enabled",
    "scanIntervalSec",
    "autoRefreshEnabled",
    "autoRefreshMinutes",
    "autoRefreshJitterSeconds"
  ]);

  if (changedSettingKeys.some((key) => schedulingKeys.has(key))) {
    scheduleAllAlarms().catch(console.error);
  }

  if (changes.discordWebhookUrl) {
    chrome.storage.local
      .set({
        discordWebhookUrl: sanitizeText(changes.discordWebhookUrl.newValue || "")
      })
      .catch((error) =>
        console.warn("Failed to mirror Discord webhook to local", error)
      );
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCAN_ALARM_NAME) {
    requestMarketplaceScans().catch(console.error);
    return;
  }

  if (alarm.name === REFRESH_ALARM_NAME) {
    refreshMarketplaceTabs().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "mmm:getSettings") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message.type === "mmm:matchFound") {
    handleMatchFound(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message.type === "mmm:recordScan") {
    recordScanSummary(message.summary)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message.type === "mmm:scanOpenTabs") {
    requestMarketplaceScans()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message.type === "mmm:testNotification") {
    sendDiscordTestNotification()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  if (message.type === "mmm:clearAlertHistory") {
    clearAlertHistory()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }

  return false;
});

async function initializeDefaults() {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const mergedSettings = {
    ...DEFAULT_SETTINGS,
    ...current,
    excludeKeywords: mergeKeywordDefaults(
      current.excludeKeywords,
      DEFAULT_SETTINGS.excludeKeywords
    )
  };
  await chrome.storage.sync.set(mergedSettings);

  const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
  await chrome.storage.local.set({
    alertedItems: runtimeState.alertedItems || {},
    stats: { ...DEFAULT_RUNTIME_STATE.stats, ...(runtimeState.stats || {}) },
    discordWebhookUrl: sanitizeText(
      runtimeState.discordWebhookUrl || mergedSettings.discordWebhookUrl || ""
    )
  });
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

function normalizeSettings(settings) {
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...settings,
    keywords: coerceKeywordArray(settings.keywords, DEFAULT_SETTINGS.keywords),
    excludeKeywords: mergeKeywordDefaults(
      settings.excludeKeywords,
      DEFAULT_SETTINGS.excludeKeywords
    ),
    minPrice: normalizeOptionalNumber(settings.minPrice, 0, 500000),
    maxPrice: normalizeOptionalNumber(settings.maxPrice, 0, 500000),
    minYear: normalizeOptionalNumber(settings.minYear, 1980, 2100, true),
    maxYear: normalizeOptionalNumber(settings.maxYear, 1980, 2100, true),
    scanIntervalSec: clampNumber(settings.scanIntervalSec, [30, 45, 60, 120], 60),
    autoRefreshMinutes: clampNumber(
      settings.autoRefreshMinutes,
      [5, 7, 10],
      DEFAULT_SETTINGS.autoRefreshMinutes
    ),
    autoRefreshJitterSeconds: clampRange(
      Number(settings.autoRefreshJitterSeconds),
      0,
      180,
      DEFAULT_SETTINGS.autoRefreshJitterSeconds
    ),
    dedupeHours: clampRange(
      Number(settings.dedupeHours),
      1,
      72,
      DEFAULT_SETTINGS.dedupeHours
    )
  };

  normalizeNumericRanges(normalized, "minPrice", "maxPrice");
  normalizeNumericRanges(normalized, "minYear", "maxYear");

  return normalized;
}

function coerceKeywordArray(value, fallback, fallbackWhenEmpty = false) {
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
  const keywords = coerceKeywordArray(value, fallback, true);
  return Array.from(
    new Set(
      [...fallback, ...keywords]
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    )
  );
}

function clampNumber(value, allowedValues, fallback) {
  const number = Number(value);
  return allowedValues.includes(number) ? number : fallback;
}

function clampRange(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeOptionalNumber(value, min, max, integer = false) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  const normalized = integer ? Math.round(number) : number;
  return clampRange(normalized, min, max, normalized);
}

function normalizeNumericRanges(settings, minKey, maxKey) {
  if (settings[minKey] === null || settings[maxKey] === null) {
    return;
  }

  if (settings[minKey] > settings[maxKey]) {
    const minValue = settings[minKey];
    settings[minKey] = settings[maxKey];
    settings[maxKey] = minValue;
  }
}

async function scheduleAllAlarms() {
  const settings = await getSettings();

  await chrome.alarms.clear(SCAN_ALARM_NAME);
  await chrome.alarms.clear(REFRESH_ALARM_NAME);

  if (!settings.enabled) {
    return;
  }

  await chrome.alarms.create(SCAN_ALARM_NAME, {
    delayInMinutes: settings.scanIntervalSec / 60,
    periodInMinutes: settings.scanIntervalSec / 60
  });

  if (settings.autoRefreshEnabled) {
    await scheduleNextRefresh(settings);
  }
}

async function scheduleNextRefresh(settings) {
  const jitterMinutes = Math.random() * (settings.autoRefreshJitterSeconds / 60);
  await chrome.alarms.create(REFRESH_ALARM_NAME, {
    delayInMinutes: settings.autoRefreshMinutes + jitterMinutes
  });
}

async function requestMarketplaceScans() {
  const settings = await getSettings();
  if (!settings.enabled) {
    return 0;
  }

  const tabs = await queryMarketplaceTabs();
  let count = 0;

  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }

      try {
        await injectMonitorIntoTab(tab.id);
        await requestTabScan(tab.id, "alarm");
        count += 1;
      } catch (error) {
        console.warn("Scan message failed", tab.id, error);
      }
    })
  );

  return count;
}

async function requestTabScan(tabId, source) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "mmm:scanNow",
      source
    });
  } catch (error) {
    await delay(180);
    return chrome.tabs.sendMessage(tabId, {
      type: "mmm:scanNow",
      source
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function refreshMarketplaceTabs() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoRefreshEnabled) {
    return;
  }

  const tabs = await queryMarketplaceTabs();
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }

      try {
        await chrome.tabs.reload(tab.id);
      } catch (error) {
        console.warn("Refresh failed", tab.id, error);
      }
    })
  );

  await scheduleNextRefresh(settings);
}

async function queryMarketplaceTabs() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://www.facebook.com/marketplace/*",
      "https://facebook.com/marketplace/*"
    ]
  });

  return tabs.filter((tab) => {
    const url = String(tab.url || "");
    return !/\/marketplace\/item\/\d+/i.test(url);
  });
}

async function clearAlertHistory() {
  const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
  const stats = {
    ...DEFAULT_RUNTIME_STATE.stats,
    ...(runtimeState.stats || {})
  };

  stats.notificationsSent = 0;
  stats.discordAlertsSent = 0;
  stats.discordAlertsFailed = 0;
  stats.lastAlertedAt = 0;
  stats.lastAlertedTitle = "";
  stats.lastDiscordStatus = "";
  stats.lastDiscordError = "";

  await chrome.storage.local.set({
    alertedItems: {},
    stats
  });

  const tabs = await queryMarketplaceTabs();
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "mmm:resetReportedItems"
        });
      } catch (error) {
        console.warn("Could not reset reported items for tab", tab.id, error);
      }
    })
  );

  return { clearedTabs: tabs.length };
}

async function injectMonitorIntoTab(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles.css"]
    });
  } catch (error) {
    if (!String(error?.message || "").includes("Duplicate")) {
      console.warn("CSS injection failed", tabId, error);
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (error) {
    console.warn("Script injection failed", tabId, error);
    return false;
  }
}

async function handleMatchFound(message, sender) {
  const settings = await getSettings();
  if (!settings.enabled || !message.listing) {
    return { isNew: false, reason: "disabled-or-missing" };
  }

  const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
  const stats = {
    ...DEFAULT_RUNTIME_STATE.stats,
    ...(runtimeState.stats || {})
  };
  const alertedItems = pruneAlertedItems(
    runtimeState.alertedItems || {},
    Date.now()
  );

  const listing = normalizeListing(message.listing, sender);
  if (!listing.id || !listing.url) {
    return { isNew: false, reason: "invalid-listing" };
  }

  if (listing.classification === "ignore") {
    return { isNew: false, reason: listing.reason || "ignored-listing" };
  }

  const now = Date.now();
  const dedupeWindowMs = settings.dedupeHours * 60 * 60 * 1000;
  const previousEntry = normalizeAlertEntry(alertedItems[listing.id]);
  const previousTimestamp = getLatestDeliveredTimestamp(previousEntry);
  const discordWebhookUrl = await resolveDiscordWebhookUrl(
    settings.discordWebhookUrl
  );
  const channelPlan = buildChannelPlan(settings, discordWebhookUrl);
  const channelAttempts = getChannelsToAttempt(
    channelPlan,
    previousEntry,
    now,
    dedupeWindowMs
  );

  if (channelAttempts.length === 0) {
    return {
      isNew: false,
      reason: "duplicate-within-dedupe-window",
      previousTimestamp,
      listing,
      shouldCacheInPage: true
    };
  }

  const nextEntry = {
    ...previousEntry,
    title: listing.title,
    price: listing.price,
    url: listing.url
  };
  const deliveryResults = await deliverListingAlerts(
    listing,
    channelAttempts,
    now,
    nextEntry
  );

  applyDeliveryStats(stats, listing, deliveryResults, now);

  if (hasAnyDeliveredChannel(nextEntry)) {
    alertedItems[listing.id] = nextEntry;
  } else {
    delete alertedItems[listing.id];
  }

  const trimmedAlertedItems = trimAlertedItems(alertedItems);

  await chrome.storage.local.set({
    alertedItems: trimmedAlertedItems,
    stats
  });

  const inPageDelivered = deliveryResults.deliveredChannels.includes("inPage");
  const discordFailed = deliveryResults.failedChannels.find(
    (result) => result.name === "discord"
  );

  return {
    isNew: inPageDelivered,
    listing,
    shouldCacheInPage: false,
    reason: discordFailed ? "discord-delivery-failed" : "",
    discordError: discordFailed?.error || "",
    deliveredChannels: deliveryResults.deliveredChannels,
    failedChannels: deliveryResults.failedChannels
  };
}

function buildChannelPlan(settings, discordWebhookUrl) {
  return [
    { name: "inPage" },
    settings.desktopNotificationsEnabled
      ? { name: "desktop" }
      : null,
    discordWebhookUrl
      ? { name: "discord", webhookUrl: discordWebhookUrl }
      : null,
    settings.telegramBotToken && settings.telegramChatId
      ? {
          name: "telegram",
          botToken: settings.telegramBotToken,
          chatId: settings.telegramChatId
        }
      : null,
    settings.iftttKey && settings.iftttEventName
      ? {
          name: "ifttt",
          eventName: settings.iftttEventName,
          key: settings.iftttKey
        }
      : null
  ].filter(Boolean);
}

function getChannelsToAttempt(channelPlan, previousEntry, now, dedupeWindowMs) {
  return channelPlan.filter((channel) =>
    isChannelDue(previousEntry.channels[channel.name], now, dedupeWindowMs)
  );
}

function isChannelDue(previousTimestamp, now, dedupeWindowMs) {
  const timestamp = Number(previousTimestamp || 0);
  return !timestamp || now - timestamp > dedupeWindowMs;
}

function normalizeAlertEntry(entry) {
  const fallbackTimestamp = Number(entry?.timestamp || 0);
  const rawChannels =
    entry?.channels && typeof entry.channels === "object" ? entry.channels : {};

  const channels = Object.fromEntries(
    ["inPage", "desktop", "discord", "telegram", "ifttt"].map((name) => {
      const channelTimestamp = Number(rawChannels[name] || fallbackTimestamp || 0);
      return [name, Number.isFinite(channelTimestamp) ? channelTimestamp : 0];
    })
  );

  return {
    title: sanitizeText(entry?.title),
    price: sanitizeText(entry?.price),
    url: sanitizeText(entry?.url),
    channels
  };
}

function getLatestDeliveredTimestamp(entry) {
  return Math.max(
    0,
    ...Object.values(entry?.channels || {}).map((value) => Number(value || 0))
  );
}

function hasAnyDeliveredChannel(entry) {
  return Object.values(entry?.channels || {}).some((value) => Number(value || 0) > 0);
}

function trimAlertedItems(alertedItems) {
  if (Object.keys(alertedItems).length <= MAX_ALERTED_ITEMS) {
    return alertedItems;
  }

  const sortedEntries = Object.entries(alertedItems).sort(
    (a, b) =>
      getLatestDeliveredTimestamp(normalizeAlertEntry(b[1])) -
      getLatestDeliveredTimestamp(normalizeAlertEntry(a[1]))
  );

  return Object.fromEntries(sortedEntries.slice(0, MAX_ALERTED_ITEMS));
}

async function deliverListingAlerts(listing, channelAttempts, now, nextEntry) {
  const results = [];

  for (const channel of channelAttempts) {
    try {
      await runChannelDelivery(listing, channel);
      nextEntry.channels[channel.name] = now;
      results.push({ name: channel.name, ok: true });
    } catch (error) {
      results.push({
        name: channel.name,
        ok: false,
        error: error?.message || String(error)
      });
    }
  }

  return {
    deliveredChannels: results.filter((result) => result.ok).map((result) => result.name),
    failedChannels: results.filter((result) => !result.ok)
  };
}

async function runChannelDelivery(listing, channel) {
  if (channel.name === "inPage") {
    return;
  }

  if (channel.name === "desktop") {
    await createDesktopNotification(listing);
    return;
  }

  if (channel.name === "discord") {
    await sendDiscordAlert(listing, channel.webhookUrl);
    return;
  }

  if (channel.name === "telegram") {
    await sendTelegramAlert(listing, channel.botToken, channel.chatId);
    return;
  }

  if (channel.name === "ifttt") {
    await sendIftttAlert(listing, channel.eventName, channel.key);
  }
}

function applyDeliveryStats(stats, listing, deliveryResults, now) {
  if (deliveryResults.deliveredChannels.includes("inPage")) {
    stats.notificationsSent += 1;
    stats.lastAlertedAt = now;
    stats.lastAlertedTitle = listing.title || "Marketplace match";
  }

  if (deliveryResults.deliveredChannels.includes("discord")) {
    stats.discordAlertsSent += 1;
    stats.lastDiscordStatus = `Discord sent: ${listing.title || listing.id}`;
    stats.lastDiscordError = "";
  }

  const discordFailure = deliveryResults.failedChannels.find(
    (result) => result.name === "discord"
  );
  if (discordFailure) {
    stats.discordAlertsFailed += 1;
    stats.lastDiscordStatus = `Discord failed: ${listing.title || listing.id}`;
    stats.lastDiscordError = discordFailure.error;
  }
}

function normalizeListing(listing, sender) {
  const url = cleanMarketplaceUrl(listing.url);
  const id =
    String(listing.id || "").trim() || url?.match(/\/marketplace\/item\/(\d+)/)?.[1] || "";

  return {
    id,
    title: sanitizeText(listing.title),
    price: sanitizeText(listing.price),
    location: sanitizeText(listing.location),
    snippet: sanitizeText(listing.snippet),
    classification: sanitizeText(listing.classification || "match"),
    reason: sanitizeText(listing.reason || ""),
    matchedKeywords: Array.isArray(listing.matchedKeywords)
      ? listing.matchedKeywords.map((value) => sanitizeText(value)).filter(Boolean)
      : [],
    url,
    pageTitle: sanitizeText(listing.pageTitle || sender?.tab?.title || ""),
    pageUrl: sanitizeText(listing.pageUrl || sender?.tab?.url || ""),
    foundAt: Date.now()
  };
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMarketplaceUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/marketplace\/item\/(\d+)/);
    if (!match) {
      return url.toString();
    }
    return `https://www.facebook.com/marketplace/item/${match[1]}/`;
  } catch (error) {
    try {
      const url = new URL(rawUrl, "https://www.facebook.com");
      const match = url.pathname.match(/\/marketplace\/item\/(\d+)/);
      if (!match) {
        return url.toString();
      }
      return `https://www.facebook.com/marketplace/item/${match[1]}/`;
    } catch (nestedError) {
      return "";
    }
  }
}

function pruneAlertedItems(alertedItems, now) {
  const pruned = {};

  for (const [id, entry] of Object.entries(alertedItems || {})) {
    const normalizedEntry = normalizeAlertEntry(entry);
    const latestTimestamp = getLatestDeliveredTimestamp(normalizedEntry);
    if (!latestTimestamp) {
      continue;
    }
    if (now - latestTimestamp > ALERT_RETENTION_MS) {
      continue;
    }
    pruned[id] = normalizedEntry;
  }

  return pruned;
}

async function createDesktopNotification(listing) {
  const message = [
    listing.classification === "possible" ? "Possible Match" : "Strong Match",
    listing.price,
    listing.location,
    listing.reason ? formatReasonForStatus(listing.reason) : "",
    listing.matchedKeywords?.length
      ? `匹配词: ${listing.matchedKeywords.join(", ")}`
      : ""
  ]
    .filter(Boolean)
    .join(" • ");

  await chrome.notifications.create(`match-${listing.id}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title:
      listing.classification === "possible"
        ? `Possible Match: ${listing.title || "Marketplace"}`
        : listing.title || "Marketplace match",
    message: message || listing.url || "Matching listing found"
  });
}

async function sendOutboundAlerts(listing, settings) {
  if (listing.classification === "ignore") {
    return;
  }

  const tasks = [];
  const discordWebhookUrl = await resolveDiscordWebhookUrl(
    settings.discordWebhookUrl
  );

  if (discordWebhookUrl) {
    tasks.push(sendDiscordAlert(listing, discordWebhookUrl));
  }

  if (settings.telegramBotToken && settings.telegramChatId) {
    tasks.push(
      sendTelegramAlert(
        listing,
        settings.telegramBotToken,
        settings.telegramChatId
      )
    );
  }

  if (settings.iftttKey && settings.iftttEventName) {
    tasks.push(sendIftttAlert(listing, settings.iftttEventName, settings.iftttKey));
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    console.warn("One or more outbound alerts failed", {
      listingId: listing.id,
      listingTitle: listing.title,
      failed
    });
  }
}

async function resolveDiscordWebhookUrl(preferredWebhookUrl) {
  const syncWebhookUrl = sanitizeText(preferredWebhookUrl || "");
  if (syncWebhookUrl) {
    return syncWebhookUrl;
  }

  const stored = await chrome.storage.local.get({ discordWebhookUrl: "" });
  return sanitizeText(stored.discordWebhookUrl || "");
}

function formatAlertText(listing) {
  const lines = [
    listing.classification === "possible"
      ? "Facebook Marketplace 可能匹配提醒"
      : "Facebook Marketplace 摩托车匹配提醒",
    listing.title ? `标题: ${listing.title}` : "",
    listing.price ? `价格: ${listing.price}` : "",
    listing.location ? `地点: ${listing.location}` : "",
    listing.reason ? `原因: ${formatReasonForStatus(listing.reason)}` : "",
    listing.matchedKeywords?.length
      ? `匹配词: ${listing.matchedKeywords.join(", ")}`
      : "",
    listing.pageTitle ? `搜索页: ${listing.pageTitle}` : "",
    listing.url ? `链接: ${listing.url}` : ""
  ];

  return lines.filter(Boolean).join("\n");
}

async function sendDiscordAlert(listing, webhookUrl) {
  const normalizedWebhookUrl = sanitizeText(webhookUrl);
  if (
    !normalizedWebhookUrl.startsWith("https://discord.com/api/webhooks/") &&
    !normalizedWebhookUrl.startsWith("https://discordapp.com/api/webhooks/")
  ) {
    throw new Error("Invalid Discord webhook URL");
  }

  const response = await fetch(normalizedWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: formatAlertText(listing)
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Discord webhook failed: HTTP ${response.status}${
        responseText ? ` ${responseText}` : ""
      }`
    );
  }
}

async function sendTelegramAlert(listing, botToken, chatId) {
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlertText(listing),
        disable_web_page_preview: false
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram request failed: ${response.status}`);
  }
}

async function sendIftttAlert(listing, eventName, key) {
  const response = await fetch(
    `https://maker.ifttt.com/trigger/${encodeURIComponent(
      eventName
    )}/with/key/${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value1: listing.title || "Marketplace match",
        value2: [listing.price, listing.location].filter(Boolean).join(" • "),
        value3: listing.url
      })
    }
  );

  if (!response.ok) {
    throw new Error(`IFTTT request failed: ${response.status}`);
  }
}

async function recordScanSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return;
  }

  const runtimeState = await chrome.storage.local.get(DEFAULT_RUNTIME_STATE);
  const stats = {
    ...DEFAULT_RUNTIME_STATE.stats,
    ...(runtimeState.stats || {})
  };

  stats.lastScanAt = Number(summary.timestamp) || Date.now();
  stats.lastScanPage = sanitizeText(summary.pageTitle);
  stats.lastScanListingsSeen = Number(summary.listingsSeen) || 0;
  stats.lastScanMatchesFound = Number(summary.matchesFound) || 0;
  stats.lastScanPossibleMatches = Number(summary.possibleMatches) || 0;
  stats.lastScanIgnoredListings = Number(summary.ignoredListings) || 0;

  await chrome.storage.local.set({ stats });
}

async function sendDiscordTestNotification() {
  const stored = await chrome.storage.local.get({ discordWebhookUrl: "" });
  const webhookUrl = sanitizeText(stored.discordWebhookUrl || "");

  if (
    !webhookUrl.startsWith("https://discord.com/api/webhooks/") &&
    !webhookUrl.startsWith("https://discordapp.com/api/webhooks/")
  ) {
    const error = "Invalid Discord webhook URL";
    console.error(error, { webhookUrl });
    return { ok: false, error };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Test notification from Marketplace monitor 🏍️"
      })
    });

    if (response.ok) {
      return { ok: true, message: "Discord test sent successfully" };
    }

    const responseText = await response.text();
    const error = `HTTP ${response.status}: ${responseText || "Discord test failed"}`;
    console.error("Discord test failed", {
      status: response.status,
      responseText
    });
    return { ok: false, error };
  } catch (error) {
    const message = error?.message || String(error);
    console.error("Discord test request threw", error);
    return { ok: false, error: message };
  }
}

function formatReasonForStatus(reason) {
  if (!reason) {
    return "";
  }

  if (reason.startsWith("excluded-keyword:")) {
    const keyword = reason.split(":").slice(1).join(":");
    return `Ignored: excluded keyword "${keyword}"`;
  }

  if (reason === "price-below-min") {
    return "Ignored: price below minimum";
  }

  if (reason === "price-above-max") {
    return "Ignored: price above maximum";
  }

  if (reason === "year-outside-range") {
    return "Ignored: year outside range";
  }

  if (reason === "filters-passed") {
    return "Strong Match: filters passed";
  }

  if (reason.startsWith("missing-")) {
    return `Possible Match: ${reason
      .replace(/^missing-/, "missing ")
      .replace(/-/g, " ")}`;
  }

  return reason;
}
