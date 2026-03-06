// Copyright 2026 Stanislav Senotrusov
//
// This work is dual-licensed under the Apache License, Version 2.0
// and the MIT License. Refer to the LICENSE file in the top-level directory
// for the full license terms.
//
// SPDX-License-Identifier: Apache-2.0 OR MIT

const COPY_FORMAT_OPTIONS = [
  { id: "plaintext-markdown-friendly", label: "Plain text (Markdown friendly)" },
  { id: "plaintext", label: "Plain text" },
  { id: "separator-1", type: "separator" },
  { id: "asciidoc", label: "AsciiDoc" },
  { id: "latex", label: "LaTeX" },
  { id: "markdown", label: "Markdown" },
  { id: "mediawiki", label: "MediaWiki" },
  { id: "orgmode", label: "Org mode" },
  { id: "restructuredtext", label: "reStructuredText" },
  { id: "textile", label: "Textile" }
];

const DEFAULT_COPY_FORMAT = "plaintext-markdown-friendly";

const PASTE_FORMAT_OPTIONS = [
  { id: "broad", label: "Cross-markup compatibility" },
  { id: "strict", label: "Plain text" },
  { id: "separator-1", type: "separator" },
  { id: "strict-asciidoc", label: "AsciiDoc" },
  { id: "strict-latex", label: "LaTeX" },
  { id: "strict-markdown", label: "Markdown" },
  { id: "strict-org-mode", label: "Org mode" }
];

const DEFAULT_PASTE_FORMAT = "broad";

/**
 * Registers the context menu items when the extension is installed or starts.
 * Clears any existing items, creates parent and action menus, and sets up
 * format selection submenus with correct checked states.
 * 
 * @param {object} details - Information about the install or update event.
 */
browser.runtime.onInstalled.addListener(async (details) => {
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
    { id: "copy-all-tabs", title: "Copy &all tabs" },
    { id: "copy-unpinned-tabs", title: "&Copy unpinned tabs" },
    { id: "copy-selected-tabs", title: "Copy &selected tabs" },
    { id: "separator-1", type: "separator" },
    { id: "copy-all-tabs-from-every-window", title: "Copy all tabs from every &window" },
    { id: "copy-unpinned-tabs-from-every-window", title: "Copy &unpinned tabs from every window" },
    { id: "separator-2", type: "separator" },
    { id: "paste-tabs-into-one-window", title: "&Paste tabs into one window" },
    { id: "paste-tabs-into-multiple-windows", title: "Paste tabs into &multiple windows" }
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

  // 3. Create Format Selection Submenus
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

  await browser.menus.create({
    id: "paste-format-submenu",
    parentId: "parent-menu",
    title: "Paste format",
    contexts: ["tab"]
  });

  // Retrieve validated preferences to set the correct radio buttons
  const currentFormat = await getValidatedFormatId();
  const currentPasteFormat = await getValidatedPasteFormatId();

  for (const option of COPY_FORMAT_OPTIONS) {
    if (option.type === "separator") {
      await browser.menus.create({
        id: `format-${option.id}`,
        type: "separator",
        parentId: "format-submenu",
        contexts: ["tab"]
      });
    } else {
      await browser.menus.create({
        id: `format-${option.id}`,
        parentId: "format-submenu",
        title: option.label,
        type: "radio",
        checked: option.id === currentFormat,
        contexts: ["tab"]
      });
    }
  }

  for (const option of PASTE_FORMAT_OPTIONS) {
    if (option.type === "separator") {
      await browser.menus.create({
        id: `paste-format-${option.id}`,
        type: "separator",
        parentId: "paste-format-submenu",
        contexts: ["tab"]
      });
    } else {
      await browser.menus.create({
        id: `paste-format-${option.id}`,
        parentId: "paste-format-submenu",
        title: option.label,
        type: "radio",
        checked: option.id === currentPasteFormat,
        contexts: ["tab"]
      });
    }
  }
});

/**
 * Listens for clicks on the context menu items and dispatches the
 * appropriate copy, paste, or format selection action.
 *
 * @param {browser.menus.OnClickData} info - Information about the clicked menu item.
 * @param {browser.tabs.Tab} tab - The tab where the click occurred.
 */
browser.menus.onClicked.addListener(async (info, tab) => {
  // Handle Copy Format Selection
  if (info.menuItemId.startsWith("format-")) {
    const newFormatId = info.menuItemId.replace("format-", "");
    await browser.storage.local.set({ copyFormat: newFormatId });
    return;
  }

  // Handle Paste Format Selection
  if (info.menuItemId.startsWith("paste-format-")) {
    const newFormatId = info.menuItemId.replace("paste-format-", "");
    await browser.storage.local.set({ pasteFormat: newFormatId });
    return;
  }

  // Handle Actions
  // We fetch and validate the current format ID before processing commands
  const formatId = await getValidatedFormatId();

  if (info.menuItemId === "copy-all-tabs") {
    await copyTabs({ currentWindow: true }, formatId);

  } else if (info.menuItemId === "copy-unpinned-tabs") {
    await copyTabs({ currentWindow: true, pinned: false }, formatId);

  } else if (info.menuItemId === "copy-selected-tabs") {
    await copyTabs({ currentWindow: true, highlighted: true }, formatId);

  } else if (info.menuItemId === "copy-all-tabs-from-every-window") {
    await copyTabs({}, formatId);

  } else if (info.menuItemId === "copy-unpinned-tabs-from-every-window") {
    await copyTabs({ pinned: false }, formatId);

  } else if (info.menuItemId === "paste-tabs-into-one-window") {
    await pasteTabs();

  } else if (info.menuItemId === "paste-tabs-into-multiple-windows") {
    await pasteTabsMultipleWindows();
  }
});

/**
 * Listens for changes in local storage to keep the context menu radio buttons 
 * in sync with the saved format preferences. This ensures the UI remains accurate 
 * if settings are changed programmatically or via other components.
 *
 * @param {object} changes - Object describing the changes in storage.
 * @param {string} area - The storage area that changed (e.g., "local").
 */
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.copyFormat) {
      const newFormatId = changes.copyFormat.newValue;
      const isValid = COPY_FORMAT_OPTIONS.some(option => option.id === newFormatId);
      const targetId = isValid ? newFormatId : DEFAULT_COPY_FORMAT;

      for (const option of COPY_FORMAT_OPTIONS) {
        if (option.type !== "separator") {
          browser.menus.update(`format-${option.id}`, {
            checked: option.id === targetId
          });
        }
      }
    }

    if (changes.pasteFormat) {
      const newFormatId = changes.pasteFormat.newValue;
      const isValid = PASTE_FORMAT_OPTIONS.some(option => option.id === newFormatId);
      const targetId = isValid ? newFormatId : DEFAULT_PASTE_FORMAT;

      for (const option of PASTE_FORMAT_OPTIONS) {
        if (option.type !== "separator") {
          browser.menus.update(`paste-format-${option.id}`, {
            checked: option.id === targetId
          });
        }
      }
    }
  }
});

/**
 * Retrieves the preferred copy format ID from local storage.
 * To ensure data integrity, this function verifies that the stored ID
 * exists within the available format options. If the stored value is
 * missing, invalid, or corrupted, it falls back to a safe default.
 *
 * @returns {Promise<string>} The validated copy format ID.
 */
async function getValidatedFormatId() {
  const { copyFormat } = await browser.storage.local.get("copyFormat");
  const isValid = COPY_FORMAT_OPTIONS.some(option => option.id === copyFormat);
  return isValid ? copyFormat : DEFAULT_COPY_FORMAT;
}

/**
 * Retrieves the preferred paste format ID from local storage.
 * Similar to the copy format retrieval, this acts as a safe guard against
 * invalid stored states, reverting to the default formatting rule if needed.
 *
 * @returns {Promise<string>} The validated paste format ID.
 */
async function getValidatedPasteFormatId() {
  const { pasteFormat } = await browser.storage.local.get("pasteFormat");
  const isValid = PASTE_FORMAT_OPTIONS.some(option => option.id === pasteFormat);
  return isValid ? pasteFormat : DEFAULT_PASTE_FORMAT;
}

/**
 * A helper that takes a string and a regular expression, returning all
 * full matches as an array of strings.
 *
 * @param {string} text - The text to search for matches.
 * @param {RegExp} regex - The regular expression to use for extraction.
 * @returns {string[]} An array of fully matched strings.
 */
function extractUrlsWithSimpleRegex(text, regex) {
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[0]);
}

/**
 * Extracts URLs using a broad, cross-markup-compatible regex.
 * Designed to gracefully extract URLs from plain text and mixed markup environments.
 * - Stops at whitespace and common structural delimiters: < > " ' { } ( ) [ ]
 * - Allows matched pairs of parentheses (up to 2 levels deep) and brackets (for IPv6).
 * - Backtracks and drops trailing sentence punctuation and markdown formatting.
 *
 * @param {string} text - The text from which to extract URLs.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsBroad(text) {
  // Supports up to 2 levels of nested parentheses:
  // Level 1: \([^\s<>"'()]*\)
  // Level 2: \((?:[^\s<>"'()]|\([^\s<>"'()]*\))*\)
  const regex = /(?:https?|file):\/\/(?:[^\s<>"'()[\]{}]|\((?:[^\s<>"'()]|\([^\s<>"'()]*\))*\)|\[[^\s<>"'[\]]*\])+(?<![.,;:?!*_~])/ig;
  return extractUrlsWithSimpleRegex(text, regex);
}

/**
 * Extracts plain text URLs stopping at any whitespace or quoting character.
 *
 * @param {string} text - The text from which to extract URLs.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsStrict(text) {
  const regex = /(?:https?|file):\/\/[^\s<>"']+/ig;
  return extractUrlsWithSimpleRegex(text, regex);
}

/**
 * Extracts URLs from AsciiDoc-formatted text.
 * Supports URLs inside passthrough macros (++, +) as well as regular inline URLs.
 * The regex ensures that URLs wrapped in passthrough delimiters (like +url+)
 * are matched by the lookaround groups first, so the trailing delimiter isn't
 * consumed by the generic matcher.
 *
 * @param {string} text - The AsciiDoc-formatted text.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsAsciiDoc(text) {
  const regex = /(?:(?<=\+\+)(?:https?|file):\/\/.*?(?=\+\+)|(?<=\+)(?:https?|file):\/\/.*?(?=\+)|\b(?:https?|file):\/\/(?:(?:\[|%5B)[a-f0-9:.]+(?:(?:%25|%)[a-z0-9]+)?(?:\]|%5D)(?::\d+)?[^\s<>"'\[]*|[^\s<>"'\[]+))/ig;
  return extractUrlsWithSimpleRegex(text, regex);
}

/**
 * Extracts URLs from LaTeX-formatted text.
 * Stops on braces '}' and other typical LaTeX command borders.
 *
 * @param {string} text - The LaTeX-formatted text.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsLatex(text) {
  const regex = /(?:https?|file):\/\/[^\s<>"'}]+/ig;
  return extractUrlsWithSimpleRegex(text, regex);
}

/**
 * Extracts URLs from Markdown-formatted text, complying with CommonMark 0.31.2
 * rules and GitHub Flavored Markdown (GFM) conventions for bare URLs.
 *
 * This function handles backslash unescaping and HTML entity decoding across
 * four specific contexts:
 * 1. Pointy-bracket links/definitions: [f](<url>) or [f]: <url>
 * 2. Autolinks: <https://example.com>
 * 3. Standard inline links/definitions: [f](url) or [f]: url (supports balanced parenthesis up to 2 depths)
 * 4. Bare URLs in plain text (supports balanced parenthesis up to 2 depths).
 *
 * @param {string} text - The Markdown-formatted text.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsMarkdown(text) {
  // Group 1: Pointy brackets (supports spaces/tabs inside <>, but no line breaks)
  // Group 2: Autolink (no spaces allowed)
  // Group 3: Standard link (supports balanced parenthesis up to 2 depths)
  // Group 4: Bare URL (supports balanced parenthesis up to 2 depths, brackets 1 depth, drops GFM trailing punctuation)
  const regex = /(?:\](?:\(\s*|\:\s*)<((?:https?|file):\/\/(?:[^<>\r\n\\]|\\.)*)>)|(?:<((?:https?|file):\/\/[^\s<>]+)>)|(?:\](?:\(\s*|\:\s*)((?:https?|file):\/\/(?:(?:[^\x00-\x20\x7F()\\]|\\.)|\((?:(?:[^\x00-\x20\x7F()\\]|\\.)|\((?:[^\x00-\x20\x7F()\\]|\\.)*\))*\))*))|((?:https?|file):\/\/(?:[^\s<>"'()[\]]|\((?:[^\s<>"'()]|\([^\s<>"'()]*\))*\)|\[[^\s<>"'[\]]*\])+(?<![.,;:?!*_~]))/ig;
  const matches = [...text.matchAll(regex)];

  const escapedPunctuation = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
  const urls = [];

  for (const match of matches) {
    if (match[1]) {
      // Group 1: Unescape backslashes, decode entities
      const url = match[1].replace(escapedPunctuation, '$1');
      urls.push(decodeHtmlEntities(url));
    } else if (match[2]) {
      // Group 2: Decode entities, encode literal backslash (escapes not allowed in autolinks)
      const url = decodeHtmlEntities(match[2]);
      urls.push(url.replace(/\\/g, '%5C'));
    } else if (match[3]) {
      // Group 3: Unescape backslashes, decode entities
      const url = match[3].replace(escapedPunctuation, '$1');
      urls.push(decodeHtmlEntities(url));
    } else if (match[4]) {
      // Group 4: Decode entities (bare URLs)
      urls.push(decodeHtmlEntities(match[4]));
    }
  }
  return urls;
}

/**
 * Extracts URLs from Org mode-formatted text, handling escaped characters.
 * Matches http/s or file URLs (including IPv6), allowing escaped brackets
 * (\[, \]) and backslashes (\\) as valid path characters. Unescapes them
 * in the returned strings.
 *
 * @param {string} text - The Org mode-formatted text.
 * @returns {string[]} An array of extracted URL strings.
 */
function extractUrlsOrgMode(text) {
  const regex = /\b(?:https?|file):\/\/(?:(?:\[|%5B)[a-f0-9:.]+(?:(?:%25|%)[a-z0-9]+)?(?:\]|%5D)(?::\d+)?(?:\\\]|\\\[|\\\\|[^\s<>"'\]])*|(?:\\\]|\\\[|\\\\|[^\s<>"'\]])+)/ig;
  const urls = extractUrlsWithSimpleRegex(text, regex);
  // Unescape \], \[, and \\ returning ], [, and \
  return urls.map(url => url.replace(/\\([\]\[\\])/g, '$1'));
}

/**
 * Safely decodes HTML entities in a string.
 * Uses DOMParser to decode without executing scripts (XSS safe).
 *
 * @param {string} str - The string containing potential HTML entities.
 * @returns {string|null} The decoded string text.
 */
function decodeHtmlEntities(str) {
  const doc = new DOMParser().parseFromString(str, "text/html");
  return doc.documentElement.textContent;
}

const URL_EXTRACTORS = {
  "broad": extractUrlsBroad,
  "strict": extractUrlsStrict,
  "strict-asciidoc": extractUrlsAsciiDoc,
  "strict-latex": extractUrlsLatex,
  "strict-markdown": extractUrlsMarkdown,
  "strict-org-mode": extractUrlsOrgMode
};

/**
 * Extracts URLs from a given string by dispatching to the appropriate
 * formatting-specific parsing function.
 *
 * This function encapsulates regular expressions and post-processing logic for
 * various markup formats to ensure URLs are parsed correctly, including handling
 * of escaped characters and specific syntax rules.
 *
 * @param {string} text - The text to process.
 * @param {string} formatId - The identifier for the format syntax to extract from.
 * @returns {string[]} An array of parsed and unescaped URL strings.
 */
function extractUrls(text, formatId) {
  const extractor = URL_EXTRACTORS[formatId] || URL_EXTRACTORS["broad"];
  return extractor(text);
}

/**
 * Checks if a URL starts with an allowed protocol.
 * Skips browser-internal or extension pages.
 *
 * @param {string} url - The URL string to evaluate.
 * @returns {boolean} True if the protocol is HTTP, HTTPS, or FILE.
 */
function isAllowedProtocol(url) {
  if (!url) return false;
  return url.startsWith("http://") ||
         url.startsWith("https://") ||
         url.startsWith("file://");
}

/**
 * Escapes special LaTeX characters in a string to prevent formatting errors
 * when the string is compiled in a LaTeX document. Replaces characters
 * with their corresponding LaTeX commands or escaped versions in a single
 * pass to avoid double-escaping previously modified characters.
 *
 * @param {string} str - The text string to escape.
 * @returns {string} The LaTeX-safe escaped string.
 */
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

/**
 * Processes a URL component by decoding it to readable Unicode (IRI) and then
 * strictly encoding any non-alphanumeric characters, except for a specified
 * set of allowed structural characters. This is more aggressive than
 * `encodeURIComponent`, as it also encodes reserved symbols like `.` and `()`
 * that the standard function leaves untouched.
 *
 * @param {string} component - The URL component value (e.g., pathname, search).
 * @param {string} allowedChars - A string of characters to exempt from encoding.
 * @returns {string} The processed and encoded URL component.
 */
function encodeUrlComponent(component, allowedChars) {
  // The standard `encodeURIComponent` does not escape: - _ . ! ~ * ' ( )
  // We handle these manually to ensure all non-alphanumeric symbols
  // not in `allowedChars` are strictly encoded.
  const unescapedByURIComponent = new Set("-_.!~*'()");

  const replacer = (char) => {
    if (unescapedByURIComponent.has(char)) {
      return '%' + char.charCodeAt(0).toString(16).toUpperCase();
    }
    return encodeURIComponent(char);
  };

  // Escape regex special characters within the allowedChars string,
  // including the hyphen '-', which has special meaning inside a character class.
  const escapedAllowed = allowedChars.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const regex = new RegExp(`[^\\p{L}\\p{N}${escapedAllowed}]`, "gu");

  try {
    // Decode any existing percent-encoding, then re-encode char by char.
    return decodeURI(component).replace(regex, replacer);
  } catch {
    // If decodeURI fails, work with the original string.
    return component.replace(regex, replacer);
  }
}

/**
 * Decodes a Punycode string to Unicode according to RFC 3492.
 * This translates internationalized ASCII labels (xn--...) back into 
 * their original Unicode representation.
 *
 * @param {string} input - The Punycode string (without the 'xn--' prefix).
 * @returns {string} The decoded Unicode string.
 * @throws {Error} If the input contains invalid Punycode encoding.
 */
function decodePunycodePart(input) {
  const output = [];
  let n = 128;
  let i = 0;
  let bias = 72;
  
  const basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; j++) {
      output.push(input.charCodeAt(j));
    }
  }
  
  let inIdx = basic > 0 ? basic + 1 : 0;

  while (inIdx < input.length) {
    const oldi = i;
    let w = 1;
    let k = 36;
    
    while (true) {
      if (inIdx >= input.length) throw new Error('Invalid Punycode');
      const c = input.charCodeAt(inIdx++);
      
      let digit;
      if (c >= 48 && c <= 57) digit = c - 22;      // 0-9
      else if (c >= 65 && c <= 90) digit = c - 65; // A-Z
      else if (c >= 97 && c <= 122) digit = c - 97; // a-z
      else throw new Error('Invalid Punycode character');
      
      i += digit * w;
      const t = k <= bias ? 1 : (k >= bias + 26 ? 26 : k - bias);
      if (digit < t) break;
      
      w *= 36 - t;
      k += 36;
    }
    
    const num = output.length + 1;
    let delta = oldi === 0 ? Math.floor((i - oldi) / 700) : (i - oldi) >> 1;
    delta += Math.floor(delta / num);
    
    let k2 = 0;
    while (delta > 455) {
      delta = Math.floor(delta / 35);
      k2 += 36;
    }
    bias = Math.floor(k2 + 36 * delta / (delta + 38));
    
    n += Math.floor(i / num);
    i %= num;
    output.splice(i++, 0, n);
  }
  
  return String.fromCodePoint(...output);
}

/**
 * Decodes a full domain name (authority) potentially containing Punycode labels
 * and an optional port number.
 *
 * @param {string} authority - The domain authority (e.g., 'xn--j1ail.xn--p1ai:8080').
 * @returns {string} The Unicode domain authority.
 */
function decodePunycodeDomain(authority) {
  let hostname = authority;
  let port = '';

  // Handle IPv6 to avoid treating its colons as port separators
  if (hostname.startsWith('[')) {
    return hostname; // IPv6 addresses are not Punycode encoded
  }

  // Extract port if present
  const colonIdx = hostname.lastIndexOf(':');
  if (colonIdx !== -1) {
    port = hostname.substring(colonIdx);
    hostname = hostname.substring(0, colonIdx);
  }

  const decodedHost = hostname.split('.').map(part => {
    if (part.toLowerCase().startsWith('xn--')) {
      try {
        return decodePunycodePart(part.substring(4));
      } catch (e) {
        return part; // Fallback to original if decoding fails
      }
    }
    return part;
  }).join('.');

  return decodedHost + port;
}

/**
 * Encodes the URL to be safe for text representation and markup languages,
 * while preserving international characters (Unicode) in both domain and path.
 *
 * @param {string} urlStr - The initial URL string.
 * @returns {string} The safely encoded URL string.
 */
function encodeUrlSpecialChars(urlStr) {
  try {
    const url = new URL(urlStr);

    // 1. Path, Search, Hash
    // Note: This aggressively encodes symbols like '.' in the path.
    const path = encodeUrlComponent(url.pathname, "/%");
    const search = encodeUrlComponent(url.search, "?=&+%"); // Keep + for query spaces
    const hash = encodeUrlComponent(url.hash, "#%");

    // 2. Authority (Domain)
    // Decode Punycode labels into Unicode representation
    const authority = decodePunycodeDomain(url.host);

    return url.protocol + "//" + authority + path + search + hash;

  } catch (e) {
    // Fallback for non-standard URLs: escape common markup breakers
    const replacements = { '[': '%5B', ']': '%5D', '(': '%28', ')': '%29', ' ': '%20' };
    return urlStr.replace(/[\[\]() ]/g, m => replacements[m] || m);
  }
}

/**
 * Returns an object containing formatting functions tailored to the selected
 * markup language, generating properly escaped links and section headers.
 *
 * @param {string} formatId - The identifier of the chosen markup format.
 * @returns {{link: function(string, string): string, header: function(string): string}} 
 * An object providing `link(title, url)` and `header(title)` string generators.
 */
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
    case "plaintext-markdown-friendly":
    default:
      return {
        // Appends two spaces to the title line to force a line break in Markdown
        link: (t, u) => `${t}  \n${u}\n\n`,
        header: (t) => `## ${t}\n\n`
      };
  }
}

/**
 * Processes an array of tabs and formats them into a single string representation
 * based on the selected formatting syntax, ignoring unsupported URL protocols
 * and ensuring URLs are robustly encoded.
 *
 * @param {browser.tabs.Tab[]} tabs - The array of tab objects to iterate over.
 * @param {string} formatId - The identifier for the chosen formatting syntax.
 * @returns {string} The fully formatted text block.
 */
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

/**
 * Generates a descriptive header string for a window grouping based on the
 * three most frequent domains among its tabs. Formats the header using the
 * selected markup syntax.
 *
 * @param {browser.tabs.Tab[]} winTabs - The array of tabs present in the window.
 * @param {string} formatId - The identifier for the chosen formatting syntax.
 * @returns {string} The formatted window header.
 */
function generateWindowHeader(winTabs, formatId) {
  const formatter = getFormatProfile(formatId);
  const domainsCount = new Map();

  // 1. Count domains
  for (const t of winTabs) {
    if (!isAllowedProtocol(t.url)) continue;
    try {
      let domain = t.url.startsWith("file://") ? "file" : new URL(t.url).hostname;
      if (domain && domain !== "file") {
        domain = decodePunycodeDomain(domain);
      }
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

/**
 * Queries tabs based on the specified options, formats their titles and URLs
 * into the desired format style, and copies the resulting string to the clipboard.
 * Applies header grouping when tabs from multiple windows are queried.
 *
 * @param {object} queryOptions - The filter query options for `browser.tabs.query`.
 * @param {string} formatId - The identifier for the format syntax to use.
 * @returns {Promise<void>}
 */
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

/**
 * Reads text content from the clipboard, extracts URLs using the current
 * configured paste format, and opens each URL in a new tab within the
 * current active window.
 *
 * @returns {Promise<void>}
 */
async function pasteTabs() {
  try {
    // Read the text content from the clipboard and extract the URLs based on format
    const clipboardText = await navigator.clipboard.readText();
    const formatId = await getValidatedPasteFormatId();
    const urls = extractUrls(clipboardText, formatId);

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

/**
 * Linearly parses clipboard text to identify structure, extracting URLs
 * and reconstructing window boundaries. URLs are spawned into the current
 * window or into multiple newly created windows when formatting headers
 * are encountered acting as dividers.
 *
 * @returns {Promise<void>}
 */
async function pasteTabsMultipleWindows() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    const lines = clipboardText.split(/\r?\n/);
    const formatId = await getValidatedPasteFormatId();

    // Evaluate the state of the current window to inform our logic
    const currentWinTabs = await browser.tabs.query({ currentWindow: true });
    const startInCurrentWindow = isWindowBlank(currentWinTabs);

    const batches = parseBatches(lines, startInCurrentWindow, formatId);
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

/**
 * Determines whether a window is "blank" by checking if it contains
 * exclusively internal or empty page tabs (e.g., about:newtab, about:blank).
 *
 * @param {browser.tabs.Tab[]} tabs - The array of tabs present in the window.
 * @returns {boolean} True if all tabs are blank pages, false otherwise.
 */
function isWindowBlank(tabs) {
  const blankPageUrls = new Set([
    "about:newtab",
    "about:home",
    "about:blank",
    "about:privatebrowsing"
  ]);
  return tabs.every(t => blankPageUrls.has(t.url));
}

/**
 * Determines if a line of text acts as a window divider based on common
 * markup language conventions for headers or horizontal rules.
 *
 * This function checks for several patterns:
 * - ATX-style headers (e.g., "## Title") used in Markdown, AsciiDoc, etc.
 * - Symmetrical headers (e.g., "==Title==") used in MediaWiki.
 * - LaTeX command-based headers (e.g., "\subsection{Title}").
 * - Setext-style underlines (e.g., "---" or "===" on a line by itself).
 *
 * @param {string} line - The line of text to evaluate.
 * @returns {boolean} True if the line is a recognized divider, false otherwise.
 */
function isWindowDivider(line) {
  // Matches ATX-style headers: Markdown (##), AsciiDoc (==), and Org mode (**).
  // These are recognized if they are followed by a space or occur alone on a line.
  // Textile (h2.) is also supported but requires a trailing space to avoid 
  // false positives with plain text starting with similar characters.
  const atxRegex = /^(?:(?:##|==|\*\*)(?:$|\s)|h2\.\s)/;

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

/**
 * Parses an array of clipboard lines into batches of URLs, where each batch is
 * intended for either the current window or a new window.
 *
 * The logic is as follows:
 * - URLs found before the first header are grouped into a "current" window batch.
 * - A header line acts as a separator, causing subsequent URLs to be grouped
 *   into a "new" window batch.
 * - If the first content is a header, the destination of the first batch depends
 *   on whether the starting window is blank.
 *
 * @param {string[]} lines - The lines of text from the clipboard.
 * @param {boolean} startInCurrentWindow - True if the first batch should open in
 *   the current window (e.g., because it's blank).
 * @param {string} formatId - The ID of the paste format to use for URL extraction.
 * @returns {Array<{type: 'current'|'new', urls: string[]}>} An array of batch objects.
 */
function parseBatches(lines, startInCurrentWindow, formatId) {
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
          currentBatch.type = "current";
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
      // Not a header. Search for URLs using the selected paste format strategy
      const urls = extractUrls(line, formatId);
      if (urls && urls.length > 0) {
        // Default to current window if no header has been seen yet
        if (!currentBatch.type) currentBatch.type = "current";
        currentBatch.urls.push(...urls);
      }
    }
  }

  // If the very first batch has no type (e.g., because the input was empty or
  // contained no headers), default it to "current".
  if (batches.length === 0 && !currentBatch.type) {
    currentBatch.type = "current";
  }

  batches.push(currentBatch); // Don't forget to store the last batch
  return batches;
}
