(() => {
  const SCRIPT_VERSION = "2026-05-21-2";

  if (window.__mmmScriptVersion === SCRIPT_VERSION) {
    return;
  }

  try {
    if (typeof window.__mmmCleanup === "function") {
      window.__mmmCleanup();
    }
  } catch (error) {
    console.warn("Previous Marketplace monitor cleanup failed", error);
  }

  window.__mmmLoaded = true;
  window.__mmmScriptVersion = SCRIPT_VERSION;
  window.__mmmInitError = "";

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
    autoScrollToMatch: true,
    copyMessageTemplate:
      "你好，请问这台 {{title}} 还在吗？我有兴趣。"
  };

  const PRICE_PATTERN = /(?:C\$|CA\$|\$|USD|CAD|€|£)\s?(\d[\d,]*(?:\.\d{2})?)/i;
  const YEAR_PATTERN = /\b(19[89]\d|20\d{2})\b/g;
  const MILEAGE_PATTERN =
    /\b(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(mi|mile|miles|km|kms)\b/i;
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    reportedItemIds: new Set(),
    urlAtInit: location.href,
    pendingMutationTimer: 0,
    pageUrlPollTimer: 0,
    observer: null,
    runtimeMessageHandler: null,
    storageChangeHandler: null,
    readyPromise: null
  };

  window.__mmmCleanup = teardown;

  installRuntimeListener();
  installStorageListener();
  state.readyPromise = init().catch((error) => {
    const message = error?.message || String(error);
    window.__mmmInitError = message;
    console.error(`Marketplace monitor init failed [${SCRIPT_VERSION}]`, error);
    return null;
  });

  async function init() {
    if (!isMarketplacePage()) {
      return;
    }

    state.settings = await loadSettings();
    installMutationObserver();
    installUrlWatcher();

    await scanPage("initial-load");
  }

  function isMarketplacePage() {
    return (
      /facebook\.com$/i.test(location.hostname) &&
      location.pathname.startsWith("/marketplace") &&
      !/\/marketplace\/item\/\d+/i.test(location.pathname)
    );
  }

  async function loadSettings() {
    try {
      const response = await sendMessage({ type: "mmm:getSettings" });
      if (response?.ok && response.settings) {
        return normalizeSettings(response.settings);
      }
    } catch (error) {
      console.warn("Could not load settings from background", error);
    }

    try {
      const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      return normalizeSettings(stored);
    } catch (error) {
      console.warn("Could not load settings from storage", error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function normalizeSettings(settings) {
    const normalized = {
      ...DEFAULT_SETTINGS,
      ...settings,
      keywords: normalizeKeywordArray(settings.keywords, DEFAULT_SETTINGS.keywords),
      excludeKeywords: mergeKeywordDefaults(
        settings.excludeKeywords,
        DEFAULT_SETTINGS.excludeKeywords
      ),
      minPrice: normalizeOptionalNumber(settings.minPrice, 0, 500000),
      maxPrice: normalizeOptionalNumber(settings.maxPrice, 0, 500000),
      minYear: normalizeOptionalNumber(settings.minYear, 1980, 2100, true),
      maxYear: normalizeOptionalNumber(settings.maxYear, 1980, 2100, true)
    };

    normalizeNumericRange(normalized, "minPrice", "maxPrice");
    normalizeNumericRange(normalized, "minYear", "maxYear");

    return normalized;
  }

  function normalizeKeywordArray(value, fallback, fallbackWhenEmpty = false) {
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
    const keywords = normalizeKeywordArray(value, fallback, true);
    return Array.from(
      new Set(
        [...fallback, ...keywords]
          .map((entry) => String(entry).trim())
          .filter(Boolean)
      )
    );
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
    return Math.min(Math.max(normalized, min), max);
  }

  function normalizeNumericRange(settings, minKey, maxKey) {
    if (settings[minKey] === null || settings[maxKey] === null) {
      return;
    }

    if (settings[minKey] > settings[maxKey]) {
      const minValue = settings[minKey];
      settings[minKey] = settings[maxKey];
      settings[maxKey] = minValue;
    }
  }

  function installRuntimeListener() {
    state.runtimeMessageHandler = (message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === "mmm:scanNow") {
        waitUntilReady()
          .then(() => scanPage(message.source || "background"))
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) =>
            sendResponse({ ok: false, error: error?.message || String(error) })
          );
        return true;
      }

      if (message.type === "mmm:resetReportedItems") {
        state.reportedItemIds.clear();
        sendResponse({ ok: true });
        return false;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(state.runtimeMessageHandler);
  }

  function installStorageListener() {
    state.storageChangeHandler = (changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      const nextSettings = { ...state.settings };
      let hasRelevantChanges = false;

      for (const [key, value] of Object.entries(changes)) {
        nextSettings[key] = value.newValue;
        hasRelevantChanges = true;
      }

      if (!hasRelevantChanges) {
        return;
      }

      state.settings = normalizeSettings(nextSettings);
      queueMutationScan("settings-changed", 250);
    };

    chrome.storage.onChanged.addListener(state.storageChangeHandler);
  }

  function installMutationObserver() {
    state.observer = new MutationObserver(() => {
      queueMutationScan("dom-mutation", 2000);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function installUrlWatcher() {
    state.pageUrlPollTimer = window.setInterval(() => {
      if (location.href === state.urlAtInit) {
        return;
      }

      state.urlAtInit = location.href;
      state.reportedItemIds.clear();
      clearExistingDecorations();

      if (isMarketplacePage()) {
        queueMutationScan("url-change", 750);
      }
    }, 2000);
  }

  function queueMutationScan(reason, delayMs) {
    window.clearTimeout(state.pendingMutationTimer);
    state.pendingMutationTimer = window.setTimeout(() => {
      scanPage(reason).catch(console.error);
    }, delayMs);
  }

  async function scanPage(reason) {
    if (!isMarketplacePage() || !state.settings.enabled) {
      clearExistingDecorations();
      return {
        listingsSeen: 0,
        matchesFound: 0,
        possibleMatches: 0,
        ignoredListings: 0
      };
    }

    clearExistingDecorations();

    const cards = collectListingCards();
    const debugRows = [];
    let matchesFound = 0;
    let possibleMatches = 0;
    let ignoredListings = 0;
    let didAutoScroll = false;

    for (const cardData of cards) {
      const listing = extractListing(cardData);
      if (!listing) {
        continue;
      }

      decorateCard(cardData.card, listing);
      debugRows.push(buildDebugRow(listing));

      if (listing.classification === "match") {
        matchesFound += 1;
        highlightCard(cardData.card, listing);
        upsertActionBar(cardData.card, listing);
        const wasNotified = await notifyListing(cardData.card, listing, didAutoScroll);
        didAutoScroll = didAutoScroll || wasNotified.didAutoScroll;
        continue;
      }

      if (listing.classification === "possible") {
        possibleMatches += 1;
        markPossibleCard(cardData.card, listing);
        upsertActionBar(cardData.card, listing);
        const wasNotified = await notifyListing(cardData.card, listing, didAutoScroll);
        didAutoScroll = didAutoScroll || wasNotified.didAutoScroll;
        continue;
      }

      ignoredListings += 1;
    }

    logDebugRows(reason, debugRows);

    await sendMessage({
      type: "mmm:recordScan",
      summary: {
        timestamp: Date.now(),
        pageTitle: document.title,
        pageUrl: location.href,
        listingsSeen: cards.length,
        matchesFound,
        possibleMatches,
        ignoredListings,
        reason
      }
    }).catch(() => {});

    return {
      listingsSeen: cards.length,
      matchesFound,
      possibleMatches,
      ignoredListings
    };
  }

  async function notifyListing(card, listing, alreadyScrolled) {
    const response = await sendMessage({
      type: "mmm:matchFound",
      listing: {
        id: listing.id,
        title: listing.title,
        price: listing.price,
        location: listing.location,
        snippet: listing.snippet,
        matchedKeywords: listing.matchedKeywords,
        classification: listing.classification,
        reason: listing.reason,
        url: listing.url,
        pageTitle: document.title,
        pageUrl: location.href
      }
    }).catch((error) => {
      console.warn("Match message failed", error);
      return null;
    });

    if (!response?.ok) {
      return { didAutoScroll: alreadyScrolled };
    }

    let didAutoScroll = alreadyScrolled;
    if (response?.ok && response.isNew) {
      const matchLabel =
        listing.classification === "possible"
          ? `Possible Match: ${humanizeReason(listing.reason)}`
          : listing.matchedKeywords.length
            ? `Strong Match: ${listing.matchedKeywords.join(", ")}`
            : "Strong Match";

      if (state.settings.autoScrollToMatch && !didAutoScroll) {
        scrollCardIntoView(card);
        didAutoScroll = true;
      }

      showToast(`${matchLabel}: ${listing.title || listing.url}`);
      if (state.settings.soundEnabled) {
        playAlertSound().catch(() => {});
      }
    } else if (response.reason === "duplicate-within-dedupe-window") {
      markAlreadyAlertedCard(card, listing, response.previousTimestamp);
    } else if (response.reason === "discord-delivery-failed") {
      markDeliveryIssueCard(card, listing, response.discordError);
    }

    return { didAutoScroll };
  }

  function collectListingCards() {
    const listingMap = new Map();
    const anchors = document.querySelectorAll('a[href*="/marketplace/item/"]');

    for (const anchor of anchors) {
      if (!(anchor instanceof HTMLAnchorElement)) {
        continue;
      }

      const url = cleanMarketplaceUrl(anchor.href);
      const id = extractItemId(url);
      if (!id || listingMap.has(id)) {
        continue;
      }

      const card = findCardContainer(anchor);
      if (!card) {
        continue;
      }

      listingMap.set(id, { id, url, anchor, card });
    }

    return Array.from(listingMap.values());
  }

  function extractListing(cardData) {
    const textLines = getVisibleTextLines(cardData.card);
    const combinedText = textLines.join("\n");
    if (!combinedText) {
      return null;
    }

    const title = extractTitle(textLines, cardData.anchor);
    const titleText = sanitizeText(title);
    const matchedKeywords = getMatchedKeywords(combinedText, state.settings.keywords);
    const titleMatchedKeywords = getMatchedKeywords(
      titleText,
      state.settings.keywords
    );
    const excludedKeywords = getMatchedKeywords(
      combinedText,
      state.settings.excludeKeywords
    );
    const price = extractPrice(textLines, titleText);
    const priceValue = parsePriceValue(price);
    const location = extractLocation(textLines, titleText, price);
    const yearCandidates = extractYearCandidates(titleText, combinedText);
    const mileage = extractMileage(textLines, titleText);
    const mileageValue = parseMileageValue(mileage);
    const snippet = sanitizeText(combinedText).slice(0, 280);
    const classificationResult = classifyListing(
      {
        title: titleText,
        matchedKeywords,
        titleMatchedKeywords,
        excludedKeywords,
        price,
        priceValue,
        yearCandidates,
        mileage,
        mileageValue
      },
      state.settings
    );

    return {
      id: cardData.id,
      url: cardData.url,
      title: titleText,
      price,
      priceValue,
      location,
      yearCandidates,
      mileage,
      mileageValue,
      snippet,
      matchedKeywords,
      titleMatchedKeywords,
      excludedKeywords,
      classification: classificationResult.classification,
      reason: classificationResult.reason
    };
  }

  function classifyListing(listing, settings) {
    if (!Array.isArray(settings.keywords) || settings.keywords.length === 0) {
      return { classification: "ignore", reason: "no-keywords-configured" };
    }

    if (listing.matchedKeywords.length === 0) {
      return { classification: "ignore", reason: "keyword-not-matched" };
    }

    if (listing.excludedKeywords.length > 0) {
      return {
        classification: "ignore",
        reason: `excluded-keyword:${listing.excludedKeywords[0]}`
      };
    }

    if (
      listing.priceValue !== null &&
      settings.minPrice !== null &&
      listing.priceValue < settings.minPrice
    ) {
      return { classification: "ignore", reason: "price-below-min" };
    }

    if (
      listing.priceValue !== null &&
      settings.maxPrice !== null &&
      listing.priceValue > settings.maxPrice
    ) {
      return { classification: "ignore", reason: "price-above-max" };
    }

    if (
      listing.yearCandidates.length > 0 &&
      (settings.minYear !== null || settings.maxYear !== null)
    ) {
      const hasYearInRange = listing.yearCandidates.some((year) =>
        isValueWithinRange(year, settings.minYear, settings.maxYear)
      );

      if (!hasYearInRange) {
        return { classification: "ignore", reason: "year-outside-range" };
      }
    }

    const missingFields = [];
    if (
      (settings.minPrice !== null || settings.maxPrice !== null) &&
      listing.priceValue === null
    ) {
      missingFields.push("price");
    }

    if (
      (settings.minYear !== null || settings.maxYear !== null) &&
      listing.yearCandidates.length === 0
    ) {
      missingFields.push("year");
    }

    if (missingFields.length > 0) {
      return {
        classification: "possible",
        reason: `missing-${missingFields.join("-and-")}`
      };
    }

    return { classification: "match", reason: "filters-passed" };
  }

  function isValueWithinRange(value, minValue, maxValue) {
    if (minValue !== null && value < minValue) {
      return false;
    }

    if (maxValue !== null && value > maxValue) {
      return false;
    }

    return true;
  }

  function extractTitle(lines, anchor) {
    const anchorCandidates = [
      anchor.getAttribute("aria-label"),
      anchor.textContent
    ]
      .map((value) => sanitizeText(value))
      .filter(Boolean);

    for (const candidate of anchorCandidates) {
      if (isLikelyTitle(candidate)) {
        return candidate;
      }
    }

    for (const line of lines) {
      if (isLikelyTitle(line)) {
        return line;
      }
    }

    return lines[0] || "";
  }

  function isLikelyTitle(value) {
    if (!value) {
      return false;
    }

    if (value.length < 4 || value.length > 160) {
      return false;
    }

    if (isLikelyPrice(value)) {
      return false;
    }

    if (/^(marketplace|local pickup|shipping available|new listing)$/i.test(value)) {
      return false;
    }

    if (/\b(minutes?|hours?|days?)\b/i.test(value)) {
      return false;
    }

    return /[a-z]/i.test(value);
  }

  function isLikelyPrice(value) {
    const text = sanitizeText(value);
    if (!text) {
      return false;
    }

    if (!PRICE_PATTERN.test(text)) {
      return false;
    }

    return /^(?:C\$|CA\$|\$|USD|CAD|€|£)\s?\d[\d,]*(?:\.\d{2})?$/.test(text);
  }

  function extractPrice(lines, title) {
    for (const line of [title, ...lines]) {
      const text = sanitizeText(line);
      if (!text) {
        continue;
      }

      const match = text.match(PRICE_PATTERN);
      if (match) {
        return sanitizeText(match[0]);
      }
    }

    return "";
  }

  function parsePriceValue(value) {
    const match = String(value || "").match(PRICE_PATTERN);
    if (!match) {
      return null;
    }

    const numericPrice = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(numericPrice) ? numericPrice : null;
  }

  function extractYearCandidates(title, combinedText) {
    const orderedYears = [
      ...extractYearMatches(title),
      ...extractYearMatches(combinedText)
    ];

    return Array.from(new Set(orderedYears));
  }

  function extractYearMatches(text) {
    const years = [];
    const matches = String(text || "").matchAll(YEAR_PATTERN);

    for (const match of matches) {
      const year = Number(match[1]);
      if (!Number.isFinite(year)) {
        continue;
      }

      if (year < 1980 || year > 2100) {
        continue;
      }

      years.push(year);
    }

    return years;
  }

  function extractMileage(lines, title) {
    for (const line of [title, ...lines]) {
      const text = sanitizeText(line);
      if (!text) {
        continue;
      }

      const match = text.match(MILEAGE_PATTERN);
      if (match) {
        return `${match[1]} ${match[2]}`;
      }
    }

    return "";
  }

  function parseMileageValue(value) {
    const match = String(value || "").match(MILEAGE_PATTERN);
    if (!match) {
      return null;
    }

    const mileage = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(mileage) ? mileage : null;
  }

  function extractLocation(lines, title, price) {
    for (const line of lines) {
      if (!line || line === title || line === price) {
        continue;
      }

      if (line.length > 80) {
        continue;
      }

      if (/^(marketplace|new listing|local pickup)$/i.test(line)) {
        continue;
      }

      if (/\b(minutes?|hours?|days?)\b/i.test(line)) {
        continue;
      }

      if (YEAR_PATTERN.test(line)) {
        YEAR_PATTERN.lastIndex = 0;
        continue;
      }
      YEAR_PATTERN.lastIndex = 0;

      if (MILEAGE_PATTERN.test(line)) {
        continue;
      }

      if (!/[a-z]/i.test(line)) {
        continue;
      }

      return line;
    }

    return "";
  }

  function getVisibleTextLines(element) {
    const rawLines = (element.innerText || "")
      .split("\n")
      .map((line) => sanitizeText(line))
      .filter(Boolean);

    return rawLines.filter((line) => {
      if (/^(copy message|copy link|复制消息|复制链接)$/i.test(line)) {
        return false;
      }

      if (/^(open item|打开商品)$/i.test(line)) {
        return false;
      }

      if (/^(match(ed)?|keyword match|关键词匹配)$/i.test(line)) {
        return false;
      }

      if (/^(matched:|匹配:|可能匹配:)/i.test(line)) {
        return false;
      }

      return true;
    });
  }

  function sanitizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getMatchedKeywords(text, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return [];
    }

    const looseText = ` ${toLooseText(text)} `;
    const tightText = toTightText(text);

    return keywords.filter((keyword) => {
      const rawKeyword = String(keyword || "").trim();
      const looseKeyword = toLooseText(rawKeyword).trim();
      const tightKeyword = toTightText(rawKeyword);

      if (!looseKeyword) {
        return false;
      }

      const hasDigits = /\d/.test(rawKeyword);
      const hasSeparators = /[\s-]/.test(rawKeyword);
      const looseMatch = looseText.includes(` ${looseKeyword} `);

      if (hasDigits || hasSeparators) {
        return looseMatch || (tightKeyword && tightText.includes(tightKeyword));
      }

      return looseMatch;
    });
  }

  function toLooseText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function toTightText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9]+/g, "");
  }

  function findCardContainer(anchor) {
    let node = anchor.parentElement;
    let bestPrecise = null;
    let bestFallback = null;
    let depth = 0;

    while (node && node !== document.body && depth < 12) {
      if (node instanceof HTMLElement) {
        const candidate = inspectCardCandidate(node);
        if (candidate.isPreciseCard) {
          if (!bestPrecise || candidate.score > bestPrecise.score) {
            bestPrecise = { node, score: candidate.score };
          }
        } else if (candidate.isLooseCard) {
          if (!bestFallback || candidate.score > bestFallback.score) {
            bestFallback = { node, score: candidate.score };
          }
        }
      }

      node = node.parentElement;
      depth += 1;
    }

    return bestPrecise?.node || bestFallback?.node || findVisibleCardFallback(anchor);
  }

  function inspectCardCandidate(node) {
    if (!isDecoratableCardNode(node)) {
      return {
        isLooseCard: false,
        isPreciseCard: false,
        score: -999
      };
    }

    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const text = sanitizeText(node.innerText || "");
    const textLength = text.length;
    const uniqueItemLinks = countUniqueItemLinks(node);
    const area = rect.width * rect.height;
    const lineCount = countMeaningfulTextLines(node.innerText || "");
    const hasImage = Boolean(node.querySelector("img"));
    const hasPrice = PRICE_PATTERN.test(node.innerText || "");

    const isLooseCard =
      uniqueItemLinks === 1 &&
      rect.width >= 120 &&
      rect.height >= 80 &&
      textLength >= 10 &&
      textLength <= 1400;

    const isPreciseCard =
      isLooseCard &&
      rect.width <= 680 &&
      rect.height <= 900 &&
      area <= 320000 &&
      lineCount >= 2 &&
      (hasImage || hasPrice || lineCount >= 3);

    let score = 0;
    score += uniqueItemLinks === 1 ? 120 : -300;
    score += hasImage ? 20 : 0;
    score += hasPrice ? 16 : 0;
    score += ["ARTICLE", "LI"].includes(node.tagName) ? 18 : 0;
    score += ["block", "flex", "grid", "inline-block", "inline-flex"].includes(style.display)
      ? 14
      : -30;
    score += lineCount >= 2 ? 18 : -20;
    score += rect.width <= 480 ? 22 : Math.max(-30, 22 - rect.width / 20);
    score += rect.height <= 650 ? 22 : Math.max(-30, 24 - rect.height / 25);
    score += area <= 180000 ? 24 : Math.max(-50, 24 - area / 7000);

    return {
      isLooseCard,
      isPreciseCard,
      score
    };
  }

  function isDecoratableCardNode(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node.tagName === "A") {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (
      style.display === "contents" ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 70) {
      return false;
    }

    return true;
  }

  function findVisibleCardFallback(anchor) {
    let node = anchor.parentElement;
    let depth = 0;

    while (node && node !== document.body && depth < 12) {
      if (isDecoratableCardNode(node)) {
        return node;
      }

      node = node.parentElement;
      depth += 1;
    }

    return anchor.parentElement || anchor;
  }

  function countMeaningfulTextLines(text) {
    return String(text || "")
      .split("\n")
      .map((line) => sanitizeText(line))
      .filter(Boolean).length;
  }

  function countUniqueItemLinks(node) {
    const itemIds = new Set();

    node.querySelectorAll('a[href*="/marketplace/item/"]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const id = extractItemId(cleanMarketplaceUrl(anchor.href));
      if (id) {
        itemIds.add(id);
      }
    });

    return itemIds.size;
  }

  function decorateCard(card, listing) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    card.dataset.mmmItemId = listing.id;
    card.dataset.mmmItemUrl = listing.url;
    card.dataset.mmmClassification = listing.classification;
    card.dataset.mmmReason = listing.reason;
  }

  function highlightCard(card, listing) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    card.classList.add("mmm-listing-highlight");
    card.style.scrollMarginTop = "40px";
    upsertMatchChip(card, buildMatchChipLabel(listing), "match");
  }

  function markPossibleCard(card, listing) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    card.classList.add("mmm-listing-possible");
    card.style.scrollMarginTop = "40px";
    upsertMatchChip(card, `可能匹配: ${humanizeReason(listing.reason)}`, "possible");
  }

  function upsertMatchChip(card, text, tone) {
    const chip = card.querySelector(".mmm-match-chip") || document.createElement("div");
    chip.className =
      tone === "possible"
        ? "mmm-match-chip mmm-match-chip-possible"
        : "mmm-match-chip";
    chip.textContent = text;

    if (!chip.isConnected) {
      card.insertAdjacentElement("afterbegin", chip);
    }
  }

  function buildMatchChipLabel(listing, suffix = "") {
    const baseLabel = listing.matchedKeywords.length
      ? `匹配: ${listing.matchedKeywords.join(", ")}`
      : "关键词匹配";
    return suffix ? `${baseLabel} · ${suffix}` : baseLabel;
  }

  function markAlreadyAlertedCard(card, listing, previousTimestamp) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const suffix = previousTimestamp
      ? `已提醒 ${formatElapsedTime(previousTimestamp)}`
      : "已提醒过";
    upsertMatchChip(card, buildMatchChipLabel(listing, suffix), "match");
  }

  function markDeliveryIssueCard(card, listing, errorMessage) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const suffix = errorMessage
      ? `Discord 失败: ${sanitizeText(errorMessage).slice(0, 48)}`
      : "Discord 发送失败";
    upsertMatchChip(card, buildMatchChipLabel(listing, suffix), "match");
  }

  function formatElapsedTime(timestamp) {
    const elapsedMs = Date.now() - Number(timestamp || 0);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return "过";
    }

    const minutes = Math.floor(elapsedMs / 60000);
    if (minutes < 1) {
      return "刚刚";
    }

    if (minutes < 60) {
      return `${minutes} 分钟前`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} 小时前`;
    }

    const days = Math.floor(hours / 24);
    return `${days} 天前`;
  }

  function upsertActionBar(card, listing) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    let actionBar = card.querySelector(".mmm-action-bar");
    if (!actionBar) {
      actionBar = document.createElement("div");
      actionBar.className = "mmm-action-bar";

      const copyMessageButton = createActionButton("复制消息", async () => {
        const message = fillTemplate(state.settings.copyMessageTemplate, listing);
        await navigator.clipboard.writeText(message);
        showToast("已复制消息模板");
      });

      const copyLinkButton = createActionButton("复制链接", async () => {
        await navigator.clipboard.writeText(listing.url);
        showToast("已复制 Marketplace 链接");
      });

      const openButton = createActionButton("打开商品", async () => {
        window.open(listing.url, "_blank", "noopener,noreferrer");
      });

      actionBar.append(copyMessageButton, copyLinkButton, openButton);
      card.append(actionBar);
    }
  }

  function createActionButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mmm-action-button";
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        await onClick();
      } catch (error) {
        console.warn(`${label} failed`, error);
        showToast(`${label}失败`, "error");
      }
    });

    return button;
  }

  function fillTemplate(template, listing) {
    const replacements = {
      "{{title}}": listing.title || "",
      "{{price}}": listing.price || "",
      "{{location}}": listing.location || "",
      "{{url}}": listing.url || "",
      "{{matchedKeywords}}": (listing.matchedKeywords || []).join(", ")
    };

    let output = String(template || "");
    for (const [token, value] of Object.entries(replacements)) {
      output = output.replaceAll(token, value);
    }

    return output.trim();
  }

  function showToast(message, tone = "info") {
    const root = ensureToastRoot();
    const toast = document.createElement("div");
    toast.className = `mmm-toast mmm-toast-${tone}`;
    toast.textContent = message;
    root.append(toast);

    window.setTimeout(() => {
      toast.classList.add("mmm-toast-exit");
      window.setTimeout(() => toast.remove(), 400);
    }, 6000);
  }

  function ensureToastRoot() {
    let root = document.querySelector(".mmm-toast-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "mmm-toast-root";
      document.documentElement.append(root);
    }
    return root;
  }

  function scrollCardIntoView(card) {
    if (!(card instanceof HTMLElement)) {
      return;
    }

    card.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });
  }

  function buildDebugRow(listing) {
    return {
      id: listing.id,
      title: listing.title,
      text: listing.snippet,
      price: listing.price || "N/A",
      priceValue: listing.priceValue ?? "N/A",
      years: listing.yearCandidates.length
        ? listing.yearCandidates.join(", ")
        : "N/A",
      mileage: listing.mileage || "N/A",
      matchedKeywords: listing.matchedKeywords.join(", ") || "N/A",
      excludedKeywords: listing.excludedKeywords.join(", ") || "N/A",
      classification: listing.classification,
      reason: humanizeReason(listing.reason)
    };
  }

  function logDebugRows(reason, debugRows) {
    if (debugRows.length === 0) {
      return;
    }

    console.groupCollapsed(
      `[MMM] ${document.title} | ${reason} | ${debugRows.length} cards`
    );
    console.table(debugRows);
    console.groupEnd();
  }

  function humanizeReason(reason) {
    if (reason?.startsWith("excluded-keyword:")) {
      const keyword = reason.split(":").slice(1).join(":");
      return `Ignored: excluded keyword "${keyword}"`;
    }

    switch (reason) {
      case "no-keywords-configured":
        return "Ignored: no keywords configured";
      case "keyword-not-matched":
        return "Ignored: keyword not matched";
      case "excluded-keyword":
        return "Ignored: excluded keyword";
      case "price-below-min":
        return "Ignored: price below minimum";
      case "price-above-max":
        return "Ignored: price above maximum";
      case "year-outside-range":
        return "Ignored: year outside range";
      case "missing-price":
        return "Possible Match: missing price";
      case "missing-year":
        return "Possible Match: missing year";
      case "missing-price-and-year":
        return "Possible Match: missing price and year";
      case "filters-passed":
        return "Strong Match: filters passed";
      default:
        return reason || "未分类";
    }
  }

  async function playAlertSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    const notes = [
      { frequency: 880, startOffset: 0 },
      { frequency: 1174, startOffset: 0.18 }
    ];

    const now = audioContext.currentTime;
    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;

      gain.gain.setValueAtTime(0.0001, now + note.startOffset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + note.startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + note.startOffset + 0.16
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now + note.startOffset);
      oscillator.stop(now + note.startOffset + 0.17);
    }

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 600);
  }

  function cleanMarketplaceUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      const match = url.pathname.match(/\/marketplace\/item\/(\d+)/);
      if (!match) {
        return url.toString();
      }
      return `https://www.facebook.com/marketplace/item/${match[1]}/`;
    } catch (error) {
      return "";
    }
  }

  function extractItemId(url) {
    return url.match(/\/marketplace\/item\/(\d+)/)?.[1] || "";
  }

  function clearExistingDecorations() {
    document
      .querySelectorAll(".mmm-listing-highlight, .mmm-listing-possible")
      .forEach((node) => {
        node.classList.remove("mmm-listing-highlight", "mmm-listing-possible");
      });

    document.querySelectorAll(".mmm-action-bar, .mmm-match-chip").forEach((node) => {
      node.remove();
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

  function waitUntilReady() {
    return state.readyPromise || Promise.resolve();
  }

  function teardown() {
    try {
      window.clearTimeout(state.pendingMutationTimer);
      window.clearInterval(state.pageUrlPollTimer);
      state.observer?.disconnect();

      if (state.runtimeMessageHandler) {
        chrome.runtime.onMessage.removeListener(state.runtimeMessageHandler);
      }

      if (state.storageChangeHandler) {
        chrome.storage.onChanged.removeListener(state.storageChangeHandler);
      }
    } catch (error) {
      console.warn("Marketplace monitor teardown failed", error);
    }
  }
})();
