<!--
Copyright 2026 Stanislav Senotrusov

This work is dual-licensed under the Apache License, Version 2.0 and the MIT License.
See LICENSE in the top-level directory for details.

SPDX-License-Identifier: Apache-2.0 OR MIT
-->

# Copy and paste all tabs

A lightweight Firefox extension that allows you to easily copy open tabs in your current window to your clipboard, and paste a list of URLs from your clipboard to open them simultaneously. 

## Features

Right-click on any tab in your browser to access the extension's submenu, which contains the following actions:

- **Copy all tabs**: Copies a list of all *unpinned* tabs in the active window.
- **Copy all tabs (including pinned)**: Copies a list of *all* tabs in the active window, including the pinned ones.
- **Copy selected tabs**: Copies a list of all currently highlighted (selected) tabs in the active window, regardless of whether they are pinned.
- **Paste tabs**: Extracts all valid `http://`, `https://`, and `file://` URLs from your current clipboard text and instantly opens them as new tabs in the background.

### Copy Format

When copying tabs to your clipboard, the extension outputs plain text formatted like this:
```text
{tab title}
{tab url}

{tab title}
{tab url}

```

### Smart Filtering

- **Protocol Filtering:** The extension ignores browser-internal pages (like `about:config` or `about:addons`) and extension pages. It only copies standard web links (`http`/`https`) and local files (`file`). The same filter is applied when pasting.
- **Missing Titles:** If a tab happens to be missing a title, the extension will omit the empty title line and output just the URL.

## License

This project is dual-licensed under the Apache License, Version 2.0 and the MIT License. You may use this project under the terms of either license. By contributing, you agree to license your contributions under both licenses. For full license text and third-party component notices, please refer to the [LICENSE](LICENSE) file.
