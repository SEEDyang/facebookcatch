# Facebook Marketplace Motorcycle Monitor

Manifest V3 Chrome extension that scans only the Facebook Marketplace pages you already have open, highlights matching motorcycle listings, and alerts you without automating seller messaging.

## What It Does

- Scans the current DOM of already-open Facebook Marketplace tabs.
- Finds listing cards by searching for anchors whose `href` contains `/marketplace/item/`.
- Highlights matching cards and adds `Copy Message`, `Copy Link`, and `Open Item` buttons.
- Shows in-page toast alerts.
- Optionally plays an in-page sound.
- Optionally shows Chrome desktop notifications.
- Optionally sends alerts to Discord, Telegram, and IFTTT.
- Optionally reloads open Marketplace tabs every 5, 7, or 10 minutes with jitter.

## What It Does Not Do

- It does not message sellers.
- It does not click Messenger buttons.
- It does not log you in.
- It does not call Facebook private APIs.
- It does not fetch hidden Marketplace pages.

## Install

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   `/Users/seed/Documents/codex/facebook-marketplace-motorcycle-monitor`

## Use

1. Open one or more Facebook Marketplace search tabs manually.
2. Sort them the way you want, such as newest or recently listed.
3. Open the extension popup and confirm your keywords and alert settings.
4. Leave those tabs open. The extension will scan the loaded DOM on the configured cadence.

## Notes

- The extension asks for the `tabs` permission so the background worker can target Marketplace tabs for scheduled scans and optional refreshes.
- Sound playback is best-effort from the content script. If Chrome blocks autoplay in a given tab, desktop notifications and toasts still work.
- Outbound alert hosts are limited to Discord, Telegram, and IFTTT endpoints declared in `manifest.json`.
