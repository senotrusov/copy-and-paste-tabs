// Copyright 2026 Stanislav Senotrusov
//
// This work is dual-licensed under the Apache License, Version 2.0
// and the MIT License. Refer to the LICENSE file in the top-level directory
// for the full license terms.
//
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Register the context menu items when the extension is installed or starts
browser.runtime.onInstalled.addListener(async () => {
  // Clear any existing menu items to prevent errors
  await browser.menus.removeAll();

  // Await each creation to guarantee the order in the menu

  // 1. Manually create the parent menu item.
  // We use && here so the OS menu renders a single literal &
  await browser.menus.create({
    id: "parent-menu",
    title: "Cop&y && paste tabs",
    contexts: ["tab"] // Appears when right-clicking on any tab
  });

  // 2. Create the child items and attach them to the parent using 'parentId'
  await browser.menus.create({
    id: "copy-all-tabs",
    parentId: "parent-menu",
    title: "Copy &tabs from the current window",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-tabs-including-pinned",
    parentId: "parent-menu",
    title: "Copy t&abs from the current window (including pinned)",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-selected-tabs",
    parentId: "parent-menu",
    title: "Copy &selected tabs",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-windows",
    parentId: "parent-menu",
    title: "Copy tabs from all &windows",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-windows-including-pinned",
    parentId: "parent-menu",
    title: "Copy tabs from all w&indows (including pinned)",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "paste-tabs",
    parentId: "parent-menu",
    title: "&Paste tabs",
    contexts: ["tab"]
  });
});

// Listen for clicks on the context menu items
browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "copy-selected-tabs") {
    await copyTabs({ currentWindow: true, highlighted: true });
  } else if (info.menuItemId === "copy-all-tabs") {
    await copyTabs({ currentWindow: true, pinned: false });
  } else if (info.menuItemId === "copy-all-tabs-including-pinned") {
    await copyTabs({ currentWindow: true });
  } else if (info.menuItemId === "copy-all-windows") {
    await copyTabs({ pinned: false });
  } else if (info.menuItemId === "copy-all-windows-including-pinned") {
    await copyTabs({});
  } else if (info.menuItemId === "paste-tabs") {
    await pasteTabs();
  }
});

// Helper function to check if a URL has an allowed protocol
function isAllowedProtocol(url) {
  if (!url) return false;
  return url.startsWith("http://") ||
         url.startsWith("https://") ||
         url.startsWith("file://");
}

// Helper function to process an array of tabs and format them as a single string
function formatTabsToText(tabs) {
  let textToCopy = "";

  for (const t of tabs) {
    // 1. Check if the URL uses an allowed protocol
    if (!isAllowedProtocol(t.url)) {
      continue; // Skip about:, moz-extension:, etc.
    }

    let tabString = "";

    // 2. Add title only if it exists and isn't empty
    if (t.title && t.title.trim() !== "") {
      tabString += `${t.title}\n`;
    }

    // 3. Add URL and double newline
    tabString += `${t.url}\n\n`;

    textToCopy += tabString;
  }

  return textToCopy;
}

// Function to query tabs based on specified options and copy them to the clipboard
async function copyTabs(queryOptions) {
  try {
    const tabs = await browser.tabs.query(queryOptions);
    const textToCopy = formatTabsToText(tabs);

    // Write the formatted string to the clipboard
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      console.log("Successfully copied tabs to clipboard.");
    } else {
      console.log("No valid tabs found to copy.");
    }
  } catch (error) {
    console.error("Failed to copy tabs:", error);
  }
}

// Function to paste URLs from the clipboard and open them as new tabs
async function pasteTabs() {
  try {
    // Read the text content from the clipboard
    const clipboardText = await navigator.clipboard.readText();

    // Regular expression to match http, https, and file URLs
    // (?:...) is a non-capturing group. [^\s]+ matches until the next whitespace.
    const urlRegex = /(?:https?|file):\/\/[^\s]+/ig;
    const urls = clipboardText.match(urlRegex);

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
