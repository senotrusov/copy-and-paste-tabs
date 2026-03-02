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
  // Do not add a shortcut to the Parent menu to prevent conflicts with the browser's native shortcuts.
  await browser.menus.create({
    id: "parent-menu",
    title: "Copy and paste tabs",
    contexts: ["tab"] // Appears when right-clicking on any tab
  });

  // 2. Create the child items and attach them to the parent using 'parentId'
  await browser.menus.create({
    id: "copy-all-tabs",
    parentId: "parent-menu",
    title: "&Copy unpinned", // Key: C
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-tabs-including-pinned",
    parentId: "parent-menu",
    title: "Copy &all", // Key: A
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-selected-tabs",
    parentId: "parent-menu",
    title: "Copy &selected", // Key: S
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "separator-1",
    type: "separator",
    parentId: "parent-menu",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-windows",
    parentId: "parent-menu",
    title: "Copy unpinned from all &windows", // Key: W
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "copy-all-windows-including-pinned",
    parentId: "parent-menu",
    title: "Copy all from all win&dows", // Key: D
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "separator-2",
    type: "separator",
    parentId: "parent-menu",
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "paste-tabs",
    parentId: "parent-menu",
    title: "&Paste into one window", // Key: P
    contexts: ["tab"]
  });

  await browser.menus.create({
    id: "paste-tabs-multiple-windows",
    parentId: "parent-menu",
    title: "Paste into &multiple windows", // Key: M
    contexts: ["tab"]
  });
});

// Listen for clicks on the context menu items
browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "copy-all-tabs") {
    await copyTabs({ currentWindow: true, pinned: false });
  } else if (info.menuItemId === "copy-all-tabs-including-pinned") {
    await copyTabs({ currentWindow: true });
  } else if (info.menuItemId === "copy-selected-tabs") {
    await copyTabs({ currentWindow: true, highlighted: true });
  } else if (info.menuItemId === "copy-all-windows") {
    await copyTabs({ pinned: false });
  } else if (info.menuItemId === "copy-all-windows-including-pinned") {
    await copyTabs({});
  } else if (info.menuItemId === "paste-tabs") {
    await pasteTabs();
  } else if (info.menuItemId === "paste-tabs-multiple-windows") {
    await pasteTabsMultipleWindows();
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

    // 1. Store the trimmed title in a variable to avoid calling .trim() twice
    const trimmedTitle = (t.title || "").trim();

    // 2. Use the variable for the check and the assignment
    if (trimmedTitle !== "") {
      // Two trailing spaces are added to ensure a proper line break when rendered in Markdown
      tabString += `${trimmedTitle}  \n`;
    }

    // 3. Add URL and double newline
    tabString += `${t.url}\n\n`;

    textToCopy += tabString;
  }

  return textToCopy;
}

// Generates a descriptive Markdown header for a window based on the domains of its tabs.
// The header lists the top 3 most frequent domains, sorted by count then alphabetically.
function generateWindowHeader(winTabs) {
  const fallbackHeader = "## window\n\n";

  try {
    const domainsCount = new Map();

    for (const t of winTabs) {
      if (!isAllowedProtocol(t.url)) continue;
      try {
        const urlObj = new URL(t.url);
        let domain = urlObj.hostname;
        if (!domain) {
          if (t.url.startsWith("file://")) {
            domain = "file";
          } else {
            continue;
          }
        }

        // Logic: Get current count, default to 0 if undefined, then add 1
        const currentCount = domainsCount.get(domain) ?? 0;
        domainsCount.set(domain, currentCount + 1);
        
      } catch (e) {
        // Silently ignore invalid urls when counting domains
      }
    }

    // Get keys from Map and convert to an Array for sorting
    const uniqueDomains = [...domainsCount.keys()];

    if (uniqueDomains.length === 0) return fallbackHeader;

    // Sort domains by occurrence count first (from Map), then alphabetically
    uniqueDomains.sort((a, b) => {
      const diff = domainsCount.get(b) - domainsCount.get(a);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });

    // Extract top 3
    const top3 = uniqueDomains.slice(0, 3);
    let header = `## ${top3.join(", ")}`;
    
    // Add ellipsis if there are more than 3 domains
    if (uniqueDomains.length > 3) {
      header += "...";
    }
    
    return header + "\n\n";

  } catch (error) {
    // If anything unexpected happens, we log it for debugging
    // but return the fallback to keep the app running.
    console.error("Error generating window header:", error);
    return fallbackHeader;
  }
}

// Function to query tabs based on specified options and copy them to the clipboard
async function copyTabs(queryOptions) {
  try {
    const tabs = await browser.tabs.query(queryOptions);
    let textToCopy = "";

    if (queryOptions.currentWindow) {
      // For single-window actions, output a simple list without headers
      textToCopy = formatTabsToText(tabs);
    } else {
      // For multi-window actions, group tabs by windowId to provide headers for each window
      const windows = new Map();
      for (const t of tabs) {
        if (!windows.has(t.windowId)) {
          windows.set(t.windowId, []);
        }
        windows.get(t.windowId).push(t);
      }

      for (const winTabs of windows.values()) {
        const winText = formatTabsToText(winTabs);

        if (winText) {
          textToCopy += generateWindowHeader(winTabs);
          textToCopy += winText;
        }
      }
    }

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

// Function to paste URLs from the clipboard and open them as new tabs (all in current window)
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
  // Matches ATX-style and tag-like headers: Markdown (##), AsciiDoc (==), Org-mode (**), Textile (h2.)
  const atxRegex = /^(?:##|==|\*\*|h2\.)(?:$|\s)/;
  
  // Matches MediaWiki symmetrical headers (e.g., ==Heading==)
  const mediaWikiRegex = /^==.*==$/;
  
  // Matches LaTeX semantic commands
  const latexRegex = /^\\subsection\{/;
  
  // Matches Setext-style adornments/underlines for Markdown (---), reST (===, ---, or ~~~), and AsciiDoc (~~~)
  const setextRegex = /^[-~=]{3,}$/;

  return atxRegex.test(line) || 
         mediaWikiRegex.test(line) || 
         latexRegex.test(line) || 
         setextRegex.test(line);
}

// Helper to parse clipboard lines into batches of URLs for current or new windows
function parseBatches(lines, startInCurrentWindow) {
  const urlRegex = /(?:https?|file):\/\/[^\s]+/ig;
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
      const urls = line.match(urlRegex);
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
