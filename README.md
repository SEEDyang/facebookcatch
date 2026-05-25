# Facebook Marketplace Motorcycle Monitor

Chrome Manifest V3 extension for monitoring Facebook Marketplace motorcycle listings that are already open in your browser.

It scans only the DOM of Marketplace pages you keep open, highlights matches on-page, and sends alerts without automating seller messaging.

## Features

- Scans already-open Facebook Marketplace search and browse tabs.
- Detects listings by looking for links containing `/marketplace/item/`.
- Matches against configurable motorcycle keywords.
- Filters out common parts listings with exclude keywords.
- Filters by price range and year range when that information is available.
- Highlights strong matches on the page.
- Marks possible matches when key info is missing.
- Adds `复制消息`, `复制链接`, and `打开商品` buttons beside matches.
- Shows in-page toasts and optional sound alerts.
- Shows optional Chrome desktop notifications.
- Sends optional alerts to Discord, Telegram, and IFTTT.
- Supports optional Marketplace auto-refresh with jitter.
- Tracks scan stats and recent alert activity in the popup.

## Safety Boundaries

This extension is intentionally limited.

- It does not message sellers.
- It does not click Messenger buttons.
- It does not auto-login.
- It does not call Facebook private APIs.
- It does not fetch hidden or unloaded Marketplace pages.
- It only scans listings that are already present in the current page DOM.

## Project Files

- [manifest.json](manifest.json)
- [content.js](content.js)
- [background.js](background.js)
- [popup.html](popup.html)
- [popup.js](popup.js)
- [styles.css](styles.css)

## Install

1. Open `chrome://extensions/` in Chrome.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

   `/Users/seed/Documents/codex/facebook-marketplace-motorcycle-monitor`

5. Pin the extension to the Chrome toolbar if you want quick access.

## Recommended Setup

1. Open the Marketplace search tabs you care about manually.
2. Use queries such as `CBR600RR`, `CBR 600RR`, `CBR600`, `ZX6R`, `ZX-6R`, or `636`.
3. Sort each Marketplace tab by newest or recently listed.
4. Open the extension popup.
5. Save your keyword list, exclude keywords, alert options, and webhook settings.
6. Keep those Marketplace tabs open so the extension can keep scanning them.

## Popup Settings

### Matching

- `关键词`: Comma-separated keyword list.
- `排除词`: Comma-separated part keywords to ignore.
- `最低价格` and `最高价格`: Listings outside this range are ignored when price is detected.
- `最早年份` and `最晚年份`: Listings outside this range are ignored when year is detected.
- `去重时间窗`: Controls how long the same listing is suppressed before alerting again.

### Alerts

- `播放页面内提示音`
- `显示 Chrome 桌面通知`
- `发现新匹配后自动滚动到该 listing`
- `复制消息模板`

### External Push

- Discord webhook URL
- Telegram bot token and chat ID
- IFTTT event name and webhook key

### Utilities

- `立即扫描已打开标签页`
- `测试通知`
- `清空已提醒历史`

## Matching Behavior

- `Strong Match`: Keyword match passed and no clear exclusion triggered.
- `Possible Match`: Keyword match passed, but key info like price or year is missing.
- `Ignored`: Listing matched an exclude keyword, fell outside configured filters, or was classified as a part.

Examples of ignored listings:

- `CBR600RR Front Wheel`
- `CBR600RR Headers`
- `CBR 600RR Stock Exhaust`
- `Fork & Dust Seals + Bushings`

## Notifications

When configured, Discord and other outbound alerts include:

- Listing title
- Price
- Location
- Match reason
- Matched keywords
- Source Marketplace page title
- Direct Marketplace item URL

The popup also tracks:

- Total scanned listings
- Strong matches
- Possible matches
- Ignored listings
- In-page notification count
- Discord success and failure counts
- Last Discord error, if any

## Troubleshooting

### Discord test works but real listing alerts do not

- Save settings first.
- Clear alert history.
- Trigger a fresh scan.
- Check `Discord 成功`, `Discord 失败`, and `Discord 错误` in the popup.

### A listing highlights but does not alert again

- It may already be inside the dedupe window.
- Use `清空已提醒历史` to force a fresh attempt.

### Changes do not appear after editing files

1. Open `chrome://extensions/`
2. Click `Refresh` on the extension card
3. Reload the relevant Marketplace tab if needed

## Notes

- The extension uses the `tabs` permission so the background worker can reach already-open Marketplace tabs.
- Auto-refresh is optional and disabled by default.
- Sound playback is best-effort because Chrome can restrict autoplay in some tabs.
- Outbound network requests are limited to hosts declared in `manifest.json`.

## Version

Current release tag: `v0.1.0`
