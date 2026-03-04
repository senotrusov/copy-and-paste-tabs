// Copyright 2026 Stanislav Senotrusov
//
// This work is dual-licensed under the Apache License, Version 2.0
// and the MIT License. Refer to the LICENSE file in the top-level directory
// for the full license terms.
//
// SPDX-License-Identifier: Apache-2.0 OR MIT

const FORMAT_OPTIONS = [
  { id: "asciidoc", label: "AsciiDoc" },
  { id: "latex", label: "LaTeX" },
  { id: "markdown", label: "Markdown" },
  { id: "markdown-plain-links", label: "Markdown with plain links" },
  { id: "mediawiki", label: "MediaWiki" },
  { id: "orgmode", label: "Org mode" },
  { id: "plaintext", label: "Plain text" },
  { id: "restructuredtext", label: "reStructuredText" },
  { id: "textile", label: "Textile" }
];

const DEFAULT_FORMAT = "markdown-plain-links";

// Returns a new instance of the URL-matching regular expression.
// This function ensures a fresh regex object with a reset `lastIndex` is
// used for each operation, preventing state-related issues with the global flag
// in asynchronous contexts. The regex matches http/https/file schemes,
// including bracketed IPv6, and consumes URL characters until whitespace or
// common trailing markup/quote delimiters, while avoiding trailing punctuation.
function getUrlRegex() {
  return /\b(?:https?|file):\/\/(?:(?:\[|%5B)[a-fA-F0-9:.]+(?:(?:%25|%)[a-zA-Z0-9]+)?(?:\]|%5D)(?::\d+)?[^\[})\s\]>"']*|[^\[})\s\]>"']+)(?<![.,;])/ig;
}

// Register the context menu items when the extension is installed or starts
browser.runtime.onInstalled.addListener(async () => {
  // Clear any existing menu items
  await browser.menus.removeAll();

  // 1. Create parent menu
  // Do not add a shortcut to the Parent menu to prevent conflicts with the browser's native shortcuts.
  await browser.menus.create({
    id: "parent-menu",
    title: "Copy and paste tabs",
    contexts: ["tab"]
  });

  // 2. Create copy/paste actions
  const actionItems = [
    { id: "copy-all-tabs-including-pinned", title: "Copy &all tabs" },
    { id: "copy-all-tabs", title: "&Copy unpinned tabs" },
    { id: "copy-selected-tabs", title: "Copy &selected tabs" },
    { id: "separator-1", type: "separator" },
    { id: "copy-all-windows-including-pinned", title: "Copy all tabs from every &window" },
    { id: "copy-all-windows", title: "Copy &unpinned tabs from every window" },
    { id: "separator-2", type: "separator" },
    { id: "paste-tabs", title: "&Paste tabs into one window" },
    { id: "paste-tabs-multiple-windows", title: "Paste tabs into &multiple windows" }
  ];

  for (const item of actionItems) {
    await browser.menus.create({
      id: item.id,
      parentId: "parent-menu",
      title: item.title,
      type: item.type || "normal",
      contexts: ["tab"]
    });
  }

  // 3. Create Format Selection Submenu
  await browser.menus.create({
    id: "separator-format",
    type: "separator",
    parentId: "parent-menu",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "format-submenu",
    parentId: "parent-menu",
    title: "Copy format",
    contexts: ["tab"]
  });

  // Retrieve validated preference to set the correct radio button
  const currentFormat = await getValidatedFormatId();

  for (const option of FORMAT_OPTIONS) {
    await browser.menus.create({
      id: `format-${option.id}`,
      parentId: "format-submenu",
      title: option.label,
      type: "radio",
      checked: option.id === currentFormat,
      contexts: ["tab"]
    });
  }
});

// Listen for clicks on the context menu items
browser.menus.onClicked.addListener(async (info, tab) => {
  // Handle Format Selection
  if (info.menuItemId.startsWith("format-")) {
    const newFormatId = info.menuItemId.replace("format-", "");
    await browser.storage.local.set({ copyFormat: newFormatId });
    return;
  }

  // Handle Actions
  // We fetch and validate the current format ID before processing copy commands
  const formatId = await getValidatedFormatId();

  if (info.menuItemId === "copy-all-tabs") {
    await copyTabs({ currentWindow: true, pinned: false }, formatId);

  } else if (info.menuItemId === "copy-all-tabs-including-pinned") {
    await copyTabs({ currentWindow: true }, formatId);

  } else if (info.menuItemId === "copy-selected-tabs") {
    await copyTabs({ currentWindow: true, highlighted: true }, formatId);

  } else if (info.menuItemId === "copy-all-windows") {
    await copyTabs({ pinned: false }, formatId);

  } else if (info.menuItemId === "copy-all-windows-including-pinned") {
    await copyTabs({}, formatId);

  } else if (info.menuItemId === "paste-tabs") {
    await pasteTabs();

  } else if (info.menuItemId === "paste-tabs-multiple-windows") {
    await pasteTabsMultipleWindows();
  }
});

// Listens for changes in local storage to keep the context menu radio buttons 
// in sync with the saved format preference. This ensures the UI remains accurate 
// if the setting is changed programmatically or via other components.
// 
// To prevent visual glitches where multiple items appear checked, we 
// explicitly update the 'checked' state for all items in the radio group.
// If the provided format ID is not found in the valid options list, the 
// "plaintext" option is selected as a safe fallback.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.copyFormat) {
    const newFormatId = changes.copyFormat.newValue;
    const isValid = FORMAT_OPTIONS.some(option => option.id === newFormatId);
    const targetId = isValid ? newFormatId : DEFAULT_FORMAT;

    for (const option of FORMAT_OPTIONS) {
      browser.menus.update(`format-${option.id}`, {
        checked: option.id === targetId
      });
    }
  }
});

// Retrieves the preferred copy format ID from local storage.
// To ensure data integrity, this function verifies that the stored ID
// exists within the available format options. If the stored value is
// missing, invalid, or corrupted, it falls back to a safe default.
async function getValidatedFormatId() {
  const { copyFormat } = await browser.storage.local.get("copyFormat");
  const isValid = FORMAT_OPTIONS.some(option => option.id === copyFormat);
  return isValid ? copyFormat : DEFAULT_FORMAT;
}

// Helper function to check if a URL has an allowed protocol
function isAllowedProtocol(url) {
  if (!url) return false;
  return url.startsWith("http://") ||
         url.startsWith("https://") ||
         url.startsWith("file://");
}

// Escapes special LaTeX characters in a string to prevent formatting errors
// when the string is compiled in a LaTeX document. Replaces characters
// with their corresponding LaTeX commands or escaped versions in a single
// pass to avoid double-escaping previously modified characters.
function escapeLatex(str) {
  const latexReplacements = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}'
  };
  
  return str.replace(/[\\&%$#_{}~^]/g, match => latexReplacements[match]);
}

// Encodes specific characters in a URL that frequently conflict with markup
// language delimiters (e.g., brackets in AsciiDoc or parentheses in Markdown).
// It also encodes LaTeX-sensitive characters like braces and backslashes that
// could prematurely terminate the \href command. This ensures the resulting 
// link string remains syntactically valid across all supported formats.
function encodeUrlSpecialChars(url) {
  const replacements = {
    '[': '%5B',
    ']': '%5D',
    '(': '%28',
    ')': '%29',
    '{': '%7B',
    '}': '%7D',
    '`': '%60',
    '\\': '%5C'
  };
  return url.replace(/[\[\](){}`\\]/g, match => replacements[match]);
}

// Returns an object containing formatter functions for the selected markup language
function getFormatProfile(formatId) {
  switch (formatId) {
    case "asciidoc":
      return {
        link: (t, u) => `${u}[${t}]\n\n`,
        header: (t) => `== ${t}\n\n`
      };
    case "latex":
      return {
        link: (t, u) => `\\href{${u}}{${escapeLatex(t)}}\n\n`,
        header: (t) => `\\subsection*{${escapeLatex(t)}}\n\n`
      };
    case "markdown":
      return {
        link: (t, u) => `[${t}](${u})\n\n`,
        header: (t) => `## ${t}\n\n`
      };
    case "mediawiki":
      return {
        link: (t, u) => `[${u} ${t}]\n\n`,
        header: (t) => `== ${t} ==\n\n`
      };
    case "orgmode":
      return {
        link: (t, u) => `[[${u}][${t}]]\n\n`,
        header: (t) => `** ${t}\n\n`
      };
    case "restructuredtext":
    return {
        // Anonymous hyperlinks (ending in __) are used to prevent
        // "duplicate target name" errors if multiple tabs have the same title.
        link: (t, u) => `\`${t} <${u}>\`__\n\n`,
        header: (t) => `${t}\n${"-".repeat(t.length)}\n\n`
      };
    case "textile":
      return {
        link: (t, u) => `"${t}":${u}\n\n`,
        header: (t) => `h2. ${t}\n\n`
      };
    case "plaintext":
      return {
        link: (t, u) => `${t}\n${u}\n\n`,
        header: (t) => `${t}\n${"-".repeat(t.length)}\n\n`
      };
    case "markdown-plain-links":
    default:
      return {
        // Appends two spaces to the title line to force a line break in Markdown
        link: (t, u) => `${t}  \n${u}\n\n`,
        header: (t) => `## ${t}\n\n`
      };
  }
}

// Helper function to process an array of tabs and format them based on the selected syntax
function formatTabsToText(tabs, formatId) {
  let textToCopy = "";
  const formatter = getFormatProfile(formatId);

  for (const t of tabs) {
    // Check if the URL uses an allowed protocol
    if (!isAllowedProtocol(t.url)) continue; // Skip about:, moz-extension:, etc.

    const trimmedTitle = (t.title || "").trim();

    // If title is missing, fallback to the URL without its protocol scheme
    // (e.g., "example.com" instead of "https://example.com").
    const title = trimmedTitle !== ""
      ? trimmedTitle
      : t.url.replace(/^(?:https?|file):\/\//i, "");

    // Encode specific symbols to ensure compatibility with various markup syntaxes
    const encodedUrl = encodeUrlSpecialChars(t.url);

    // Add formatted link and double newline
    textToCopy += formatter.link(title, encodedUrl);
  }

  return textToCopy;
}

// Generates a descriptive header for a window based on the domains of its tabs.
// Formats the header using the selected markup syntax.
function generateWindowHeader(winTabs, formatId) {
  const formatter = getFormatProfile(formatId);
  const domainsCount = new Map();

  // 1. Count domains
  for (const t of winTabs) {
    if (!isAllowedProtocol(t.url)) continue;
    try {
      let domain = t.url.startsWith("file://") ? "file" : new URL(t.url).hostname;
      if (domain) domainsCount.set(domain, (domainsCount.get(domain) ?? 0) + 1);
    } catch (e) { /* ignore */ }
  }

  // 2. Sort and extract top 3
  const uniqueDomains = [...domainsCount.keys()];
  if (uniqueDomains.length === 0) return formatter.header("window");

  uniqueDomains.sort((a, b) => {
    const diff = domainsCount.get(b) - domainsCount.get(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  let headerText = uniqueDomains.slice(0, 3).join(", ");
  if (uniqueDomains.length > 3) headerText += "...";

  return formatter.header(headerText);
}

// Function to query tabs based on specified options and copy them to the clipboard
async function copyTabs(queryOptions, formatId) {
  try {
    const tabs = await browser.tabs.query(queryOptions);
    let textToCopy = "";

    if (queryOptions.currentWindow) {
      // For single-window actions, output a simple list without headers
      textToCopy = formatTabsToText(tabs, formatId);
    } else {
      // For multi-window actions, group tabs by windowId to provide headers for each window
      const windows = new Map();
      for (const t of tabs) {
        if (!windows.has(t.windowId)) windows.set(t.windowId, []);
        windows.get(t.windowId).push(t);
      }

      for (const winTabs of windows.values()) {
        const winText = formatTabsToText(winTabs, formatId);
        if (winText) {
          textToCopy += generateWindowHeader(winTabs, formatId);
          textToCopy += winText;
        }
      }
    }

    // Write the formatted string to the clipboard
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      console.log(`Successfully copied tabs in format ID: ${formatId}.`);
    } else {
      console.log("No valid tabs found to copy.");
    }
  } catch (error) {
    console.error("Failed to copy tabs:", error);
  }
}

// Function to paste URLs from the clipboard and open them as new tabs (all in current window)
async function pasteTabs() {
  try {
    // Read the text content from the clipboard
    const clipboardText = await navigator.clipboard.readText();
    const urls = clipboardText.match(getUrlRegex());

    if (urls && urls.length > 0) {
      // Open each extracted URL in a new tab in the order they were found
      for (const url of urls) {
        await browser.tabs.create({ url: url });
      }
      console.log(`Successfully opened ${urls.length} tabs.`);
    } else {
      console.log("No valid URLs found in the clipboard text.");
    }
  } catch (error) {
    console.error("Failed to paste tabs:", error);
  }
}

// Function to linearly parse text and open URLs in current or multiple new windows according to headers
async function pasteTabsMultipleWindows() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    const lines = clipboardText.split(/\r?\n/);

    // Evaluate the state of the current window to inform our logic
    const currentWinTabs = await browser.tabs.query({ currentWindow: true });
    const startInCurrentWindow = isWindowBlank(currentWinTabs);

    const batches = parseBatches(lines, startInCurrentWindow);
    let tabsOpenedCount = 0;

    for (const batch of batches) {
      if (batch.urls.length === 0) continue;

      if (batch.type === "current") {
        for (const url of batch.urls) {
          await browser.tabs.create({ url });
        }
      } else if (batch.type === "new") {
        // Create new window with the first URL
        const newWin = await browser.windows.create({ url: batch.urls[0] });
        // Create remaining tabs in the newly opened window
        for (let i = 1; i < batch.urls.length; i++) {
          await browser.tabs.create({ windowId: newWin.id, url: batch.urls[i] });
        }
      }
      tabsOpenedCount += batch.urls.length;
    }

    if (tabsOpenedCount > 0) {
      console.log(`Successfully opened ${tabsOpenedCount} tabs across applicable windows.`);
    } else {
      console.log("No valid URLs found in the clipboard text.");
    }
  } catch (error) {
    console.error("Failed to paste tabs into multiple windows:", error);
  }
}

// Helper to determine if a window is blank (e.g., contains only new/empty tabs)
function isWindowBlank(tabs) {
  const blankPageUrls = new Set([
    "about:newtab",
    "about:home",
    "about:blank",
    "about:privatebrowsing"
  ]);
  return tabs.every(t => blankPageUrls.has(t.url));
}

// Helper to determine if a line acts as a window divider based on various markup languages
function isWindowDivider(line) {
  // Matches ATX-style and tag-like headers: Markdown (##), AsciiDoc (==), Org mode (**), Textile (h2.)
  const atxRegex = /^(?:##|==|\*\*|h2\.)(?:$|\s)/;
  
  // Matches MediaWiki symmetrical headers (e.g., ==Heading==)
  const mediaWikiRegex = /^==.*==$/;
  
  // Matches LaTeX semantic commands
  const latexRegex = /^\\subsection\*?\s*\{/;
  
  // Matches Setext-style adornments/underlines for Markdown (---), reST (===, ---, or ~~~), and AsciiDoc (~~~)
  const setextRegex = /^[-~=]{3,}$/;

  return atxRegex.test(line) || 
         mediaWikiRegex.test(line) || 
         latexRegex.test(line) || 
         setextRegex.test(line);
}

// Helper to parse clipboard lines into batches of URLs for current or new windows
function parseBatches(lines, startInCurrentWindow) {
  const batches = [];
  let currentBatch = { type: null, urls: [] };
  let hasSeenHeader = false;

  // Linearly parse through the clipboard text
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (isWindowDivider(trimmed)) {
      if (!hasSeenHeader) {
        hasSeenHeader = true;
        // If URLs were found before the first header, they form a batch
        if (currentBatch.urls.length > 0) {
          // Not sure if this assignment is necessary since it is set
          // to "current" below, but I am too tired for my thoughts
          // to come together on that. Reassigning the same value
          currentBatch.type = "current"; // should not cause any issues.
          batches.push(currentBatch);
          currentBatch = { type: "new", urls: [] };
        } else {
          // No URLs before header; decide based on window state
          currentBatch.type = startInCurrentWindow ? "current" : "new";
        }
      } else {
        // Subsequent headers always start a new window
        batches.push(currentBatch);
        currentBatch = { type: "new", urls: [] };
      }
    } else {
      // Not a header. Search for URLs
      const urls = line.match(getUrlRegex());
      if (urls) {
        // Default to current window if no header has been seen yet
        if (!currentBatch.type) currentBatch.type = "current";
        currentBatch.urls.push(...urls);
      }
    }
  }
  batches.push(currentBatch); // Don't forget to store the last batch
  return batches;
}
