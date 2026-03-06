// Copyright 2026 Stanislav Senotrusov
//
// This work is dual-licensed under the Apache License, Version 2.0
// and the MIT License. Refer to the LICENSE file in the top-level directory
// for the full license terms.
//
// SPDX-License-Identifier: Apache-2.0 OR MIT

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert');

// --- 1. Infrastructure & Mock Setup ---

// Maintain mock state to verify side effects in integration-style tests
const mockState = {
  storage: {},
  tabsQueried: [],
  tabsCreated: [],
  windowsCreated: [],
  clipboardText: ""
};

function resetMockState() {
  mockState.storage = {};
  mockState.tabsQueried = [];
  mockState.tabsCreated = [];
  mockState.windowsCreated = [];
  mockState.clipboardText = "";
}

// Mock the Browser Extension API required for background.js to load and execute
const mockBrowser = {
  runtime: {
    onInstalled: { addListener: () => {} }
  },
  menus: {
    create: async () => {},
    removeAll: async () => {},
    update: async () => {},
    onClicked: { addListener: () => {} }
  },
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === 'string') {
          return { [key]: mockState.storage[key] };
        }
        return mockState.storage;
      },
      set: async (obj) => {
        Object.assign(mockState.storage, obj);
      }
    },
    onChanged: { addListener: () => {} }
  },
  tabs: {
    query: async (opts) => mockState.tabsQueried,
    create: async (opts) => {
      mockState.tabsCreated.push(opts);
    }
  },
  windows: {
    create: async (opts) => {
      const win = { id: mockState.windowsCreated.length + 1, ...opts };
      mockState.windowsCreated.push(win);
      return win;
    }
  }
};

const mockNavigator = {
  clipboard: {
    writeText: async (text) => {
      mockState.clipboardText = text;
    },
    readText: async () => mockState.clipboardText
  }
};

// Mock DOMParser for HTML entity decoding (used in Markdown extraction)
class MockDOMParser {
  parseFromString(str, mimeType) {
    return {
      documentElement: {
        textContent: this._decode(str)
      }
    };
  }

  // Simple entity decoder for test purposes
  _decode(str) {
    if (!str) return str;
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}

// Create the sandbox environment
const sandbox = {
  browser: mockBrowser,
  console: {
    log: () => {}, // Suppress general logs during tests
    error: console.error
  },
  DOMParser: MockDOMParser,
  navigator: mockNavigator,
  URL: URL,
  encodeURIComponent: encodeURIComponent,
  decodeURI: decodeURI,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};

// Load and execute background.js in the sandbox
const bgPath = path.join(__dirname, 'background.js');
console.log(`Loading ${bgPath}...`);
const bgCode = fs.readFileSync(bgPath, 'utf8');

vm.createContext(sandbox);
vm.runInContext(bgCode, sandbox);

// Reference the extracted functions
const {
  extractUrls,
  isAllowedProtocol,
  escapeLatex,
  encodeUrlComponent,
  decodePunycodePart,
  decodePunycodeDomain,
  encodeUrlSpecialChars,
  decodeHtmlEntities,
  isWindowBlank,
  isWindowDivider,
  getFormatProfile,
  formatTabsToText,
  generateWindowHeader,
  parseBatches,
  getValidatedFormatId,
  getValidatedPasteFormatId,
  copyTabs,
  pasteTabs,
  pasteTabsMultipleWindows
} = sandbox;

// --- 2. URL Extraction Test Suite ---

const MARKDOWN_SHARED_TEST_CASES = [
  {
    name: "Standard link",
    input: "[Link Title](https://example.com)",
    expected: ["https://example.com"]
  },
  {
    name: "Standard link with double-quote title",
    input: '[Link Title](https://example.com "The Title")',
    expected: ["https://example.com"]
  },
  {
    name: "Standard link with single-quote title (CommonMark)",
    input: "[Link Title](https://example.com 'The Title')",
    expected: ["https://example.com"]
  },
  {
    name: "Standard link with parenthesized title (CommonMark)",
    input: "[Link Title](https://example.com (The Title))",
    expected: ["https://example.com"]
  },
  {
    name: "Balanced parentheses in URL (no escape needed)",
    input: "[link](http://example.com/foo(bar))",
    expected: ["http://example.com/foo(bar)"]
  },
  // --- Specific Escaping Cases ---
  {
    name: "Angle brackets wrap URL with parens",
    input: "[Title](<http://example.com/file(1).jpg>)",
    expected: ["http://example.com/file(1).jpg"]
  },
  
  // --- Reference Links ---
  {
    name: "Full reference link (basic)",
    input: "[foo][bar] \n\n [bar]: https://example.com/ref",
    expected: ["https://example.com/ref"]
  },
  {
    name: "Reference link case-insensitive matching",
    input: "[foo][BaR] \n\n [bar]: https://example.com/insensitive",
    expected: ["https://example.com/insensitive"]
  },
  {
    name: "Collapsed reference link",
    input: "[foo][] \n\n [foo]: https://example.com/collapsed",
    expected: ["https://example.com/collapsed"]
  },
  {
    name: "Shortcut reference link",
    input: "[foo] \n\n [foo]: https://example.com/shortcut",
    expected: ["https://example.com/shortcut"]
  },
  {
    name: "Reference definition with angle brackets and title",
    input: "[id]: <https://example.com/angle> 'Title' \n [id]",
    expected: ["https://example.com/angle"]
  },
  {
    name: "Reference definition indented (up to 3 spaces)",
    input: "   [id]: https://example.com/indented \n [id]",
    expected: ["https://example.com/indented"]
  },
  
  // --- Autolinks ---
  {
    name: "URI Autolink",
    input: "<https://example.com/auto>",
    expected: ["https://example.com/auto"]
  },
  {
    name: "Email Autolink",
    // Standard CommonMark HTML rendering is <a href="mailto:...">
    input: "<foo@bar.com>",
    expected: [] 
  },
  {
    name: "Uppercase scheme Autolink",
    input: "<MAILTO:FOO@BAR.BAZ>",
    expected: []
  },
  
  // --- Images ---
  {
    name: "Image link (inline)",
    input: "![Alt Text](https://example.com/image.png)",
    expected: ["https://example.com/image.png"]
  },
  {
    name: "Image link (reference)",
    input: "![Alt][img] \n [img]: https://example.com/ref-image.png",
    expected: ["https://example.com/ref-image.png"]
  },

  // --- Edge Cases / Misc ---
  {
    name: "Link inside HTML tags (Raw HTML)",
    input: '<a href="http://example.com/html">link</a>',
    expected: ["http://example.com/html"]
  },
  {
    name: "Bare URL detection within Markdown text",
    input: "Check https://bare.com out",
    expected: ["https://bare.com"]
  },
  {
    name: "Trailing punctuation in bare URL",
    input: "Go to https://example.com.",
    expected: ["https://example.com"]
  },
  // --- Markdown: Extended Edge Cases ---
  {
    name: "Reference definition with title on next line (not standard strict CommonMark regex but often handled)",
    // Our regex `(?:\(\s*|\:\s*)` expects the URL to follow.
    // `[id]: <url>`
    // The regex group 1 is `(?:\](?:\(\s*|\:\s*)<((?:https?|file):\/\/(?:[^<>\r\n\\]|\\.)*)>)`
    // It requires the URL to be inside `<...>` for this group or bare URL for group 3.
    input: "[id]: https://example.com/split\n'Title'",
    expected: ["https://example.com/split"]
  },
  {
    name: "Reference definition with title separated by whitespace",
    input: "[id]: https://example.com/ref-space   \"Title\"",
    expected: ["https://example.com/ref-space"]
  },
  {
    name: "Autolink with no spaces allowed",
    input: "<https://example.com/no space>",
    // Autolinks (group 2) `(?:<((?:https?|file):\/\/[^\s<>]+)>)` do not allow spaces.
    // This will fail the autolink match.
    // It might be picked up by the bare URL matcher (group 4) if `<` is seen as text,
    // but bare URL matcher `[^\s<>"'()[\]]`. It stops at space.
    // So expected is just `https://example.com/no`.
    expected: ["https://example.com/no"]
  },
  {
    name: "File protocol in Markdown inline link",
    input: "[Local](file:///C:/path/to/file.txt)",
    expected: ["file:///C:/path/to/file.txt"]
  },
  {
    name: "File protocol in Markdown autolink",
    input: "<file:///etc/passwd>",
    expected: ["file:///etc/passwd"]
  },
  {
    name: "Bare URL dropping trailing markdown chars",
    input: "Check out https://example.com/foo_ and https://example.com/bar*",
    expected: ["https://example.com/foo", "https://example.com/bar"]
  },
  {
    name: "Bare URL with IPv6",
    input: "Bare IPv6: http://[2001:db8::1]:8080/path",
    expected: ["http://[2001:db8::1]:8080/path"]
  },
  {
    name: "Standard reference definition with balanced parentheses",
    input: "[id]: http://example.com/a(b)c \n [id]",
    expected: ["http://example.com/a(b)c"]
  },
  {
    name: "Bare URL with parens inside text parens",
    input: "Some text (see http://example.com/a(b)c) with more text.",
    expected: ["http://example.com/a(b)c"]
  }
];

const URL_EXTRACTION_TEST_SUITE = [
  // -------------------------------------------------------------------------
  // 1. Broad (Cross-markup compatibility / Mixed Text)
  // -------------------------------------------------------------------------
  {
    format: "broad",
    description: "Broad",
    cases: [
      {
        input: "Just a link https://example.com inside text.",
        expected: ["https://example.com"]
      },
      {
        input: "Two links: https://a.com and http://b.com.",
        expected: ["https://a.com", "http://b.com"]
      },
      {
        // Balanced parentheses (Wikipedia style) should be preserved
        input: "Wikipedia style: https://en.wikipedia.org/wiki/Pc_(identifier)",
        expected: ["https://en.wikipedia.org/wiki/Pc_(identifier)"]
      },
      {
        // Unbalanced parentheses (URL inside text parens) should exclude closing paren
        input: "Check this link (https://example.com).",
        expected: ["https://example.com"]
      },
      {
        input: "IPv6 brackets: http://[2001:db8::1]:8080/path",
        expected: ["http://[2001:db8::1]:8080/path"]
      },
      {
        input: "Ignore trailing punctuation: https://example.com/foo, bar; baz.",
        expected: ["https://example.com/foo"]
      },
      {
        // Markdown bold syntax overlapping with URL chars
        input: "Ignore markdown bold: **https://example.com**",
        expected: ["https://example.com"]
      },
      {
        // Angle brackets often used to delimit URLs in text/email
        input: "Ignore angle brackets: <https://example.com>",
        expected: ["https://example.com"]
      },
      {
        input: "URL with query string: https://example.com/search?q=test&page=1",
        expected: ["https://example.com/search?q=test&page=1"]
      },
      // --- JSON, CSV, and Encoded ---
      {
        name: "JSON string",
        input: '{ "id": 1, "url": "https://example.com/json" }',
        expected: ["https://example.com/json"]
      },
      {
        name: "CSV line",
        input: '1,"https://example.com/csv",Title',
        expected: ["https://example.com/csv"]
      },
      {
        name: "URL Encoded characters",
        input: "https://example.com/search?q=hello%20world",
        expected: ["https://example.com/search?q=hello%20world"]
      },
      // --- Broad: Extended Edge Cases ---
      {
        name: "Backtracking trailing dots",
        input: "Check https://example.com/foo...",
        expected: ["https://example.com/foo"]
      },
      {
        name: "Internal punctuation preserved",
        input: "https://example.com/a.b,c;d?e=f",
        expected: ["https://example.com/a.b,c;d?e=f"]
      },
      {
        name: "Unicode characters in path",
        input: "https://example.com/ümlaut",
        expected: ["https://example.com/ümlaut"]
      },
      {
        name: "Surrounded by punctuation",
        input: ";https://example.com/foo;",
        expected: ["https://example.com/foo"]
      },
      {
        name: "Surrounded by brackets that are not part of URL",
        input: "[https://example.com/foo]",
        expected: ["https://example.com/foo"]
      },
      {
        name: "Mixed brackets and parens (IPv6 inside parens)",
        input: "(http://[2001:db8::1])",
        expected: ["http://[2001:db8::1]"]
      },
      {
        name: "Stops at braces",
        input: "Here is a URL inside braces: {https://example.com/foo} and {http://example.org/bar}",
        expected: ["https://example.com/foo", "http://example.org/bar"]
      },
      {
        name: "Drops trailing markdown formatting characters",
        input: "Look at https://example.com/foo_, https://example.com/bar*, and https://example.com/baz~.",
        expected: ["https://example.com/foo", "https://example.com/bar", "https://example.com/baz"]
      },
      {
        name: "File protocol in broad",
        input: "Local file: file:///C:/path/to/file.txt",
        expected: ["file:///C:/path/to/file.txt"]
      },
      {
        name: "Bare URL with brackets inside text brackets (Broad)",
        input: "Some text [see http://example.com/a[b]c] with more text.",
        expected: ["http://example.com/a[b]c"]
      },
      // --- Nested Parentheses Support ---
      {
        name: "2 levels of nested parentheses",
        input: "http://example.com/foo(really(good)ok)ok",
        expected: ["http://example.com/foo(really(good)ok)ok"]
      },
      {
        name: "3 levels of nested parentheses (stops before)",
        input: "http://example.com/foo(((bad)))",
        // Should stop before the first parens because content (((bad))) doesn't match 2-level structure
        expected: ["http://example.com/foo"]
      },
      ...MARKDOWN_SHARED_TEST_CASES
    ]
  },

  // -------------------------------------------------------------------------
  // 2. Strict (Plain text / No specific markup)
  // -------------------------------------------------------------------------
  {
    format: "strict",
    description: "Strict",
    cases: [
      {
        input: "Simple https://example.com",
        expected: ["https://example.com"]
      },
      {
        input: "In quotes 'https://example.com'",
        expected: ["https://example.com"]
      },
      {
        input: "Stops at space https://example.com/foo bar",
        expected: ["https://example.com/foo"]
      },
      {
        input: "Includes trailing dot if part of path? No, usually trailing dot is punctuation. https://example.com/file.txt.",
        expected: ["https://example.com/file.txt."]
      },
      {
        // Complex parens in 'strict' often fall back to a simpler regex that might consume the closing paren 
        // if not specifically handling balanced nesting. 
        // Assumption check: Does the strict regex handle (bar) correctly if it's not nested?
        input: "Does not support complex parens nicely https://example.com/foo(bar)",
        expected: ["https://example.com/foo(bar)"] 
      },
      {
        // Check surrounding parens in strict mode
        input: "(https://example.com)",
        expected: ["https://example.com)"]
      },
      {
        // Commas inside URL (query params) vs trailing
        input: "https://example.com/map?coords=1.2,3.4",
        expected: ["https://example.com/map?coords=1.2,3.4"]
      },
      {
        input: "https://example.com/end,",
        expected: ["https://example.com/end,"]
      },
      // --- Multiline Case ---
      {
        name: "Title followed by URL on next line",
        input: "My Title\nhttps://example.com/multiline",
        expected: ["https://example.com/multiline"]
      },
      // --- Strict: Extended Edge Cases ---
      {
        name: "Trailing dot strictly consumed",
        input: "https://example.com.",
        expected: ["https://example.com."]
      },
      {
        name: "Stops at angle bracket (HTML/XML)",
        input: "https://example.com<br>",
        expected: ["https://example.com"]
      },
      {
        name: "Stops at double quote",
        input: 'href="https://example.com"',
        expected: ["https://example.com"]
      },
      {
        name: "File protocol in strict",
        input: "file:///var/log/syslog",
        expected: ["file:///var/log/syslog"]
      },
      {
        name: "Stops at single quote",
        input: "href='https://example.com/page'",
        expected: ["https://example.com/page"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 3. Markdown (Strict syntax parsing per CommonMark 0.31.2)
  // -------------------------------------------------------------------------
  {
    format: "strict-markdown",
    description: "Markdown",
    cases: [
      {
        name: "Angle brackets allow spaces in URL",
        input: "[link]( <https://example.com/foo bar> )",
        expected: ["https://example.com/foo bar"]
      },
      // TODO: Maybe
      // {
      //   name: "Nested balanced parentheses in URL (CommonMark allows)",
      //   input: "[link](http://example.com/foo(and(bar)))",
      //   expected: ["http://example.com/foo(and(bar))"]
      // },
      {
        name: "Unbalanced parentheses MUST be escaped",
        input: "[link](http://example.com/foo\\(bar)",
        expected: ["http://example.com/foo(bar"]
      },
      {
        name: "Angle brackets protect unbalanced parentheses",
        input: "[link](<http://example.com/foo(bar>)",
        expected: ["http://example.com/foo(bar"]
      },
      {
        name: "Escaped char (closing bracket) in URL",
        input: "[link](http://example.com/foo\\]bar)",
        expected: ["http://example.com/foo]bar"]
      },
      {
        name: "Escaped char (angle bracket) inside angle brackets",
        input: "[link](<http://example.com/foo\\>bar>)",
        expected: ["http://example.com/foo>bar"]
      },
      {
        name: "Backslash escape in URL (parenthesis)",
        input: "[Title](http://ex.com/file\\(1\\).jpg)",
        expected: ["http://ex.com/file(1).jpg"]
      },
      {
        name: "HTML Entity decoding in URL",
        input: "[link](http://example.com?a=1&amp;b=2)",
        expected: ["http://example.com?a=1&b=2"]
      },
      {
        name: "Autolink with entities",
        input: "<https://example.com/foo&amp;bar>",
        expected: ["https://example.com/foo&bar"]
      },
      {
        name: "Standard link with backslash escaping close paren",
        input: "[link](https://example.com/foo\\)bar)",
        expected: ["https://example.com/foo)bar"]
      },
      {
        name: "Pointy bracket link with escaped close angle",
        input: "[link](<https://example.com/foo\\>bar>)",
        expected: ["https://example.com/foo>bar"]
      },
      {
        name: "Pointy brackets with HTML entities",
        input: "[link](<http://example.com?a=1&amp;b=2>)",
        expected: ["http://example.com?a=1&b=2"]
      },
      {
        name: "Bare URL with HTML entities",
        input: "Plain text http://example.com?a=1&amp;b=2 in a paragraph.",
        expected: ["http://example.com?a=1&b=2"]
      },
      // --- Nested Parentheses Support ---
      {
        name: "Standard link with 2 levels of nested parentheses",
        input: "[link](http://example.com/foo(really(good)ok)ok)",
        expected: ["http://example.com/foo(really(good)ok)ok"]
      },
      {
        name: "Bare URL with 2 levels of nested parentheses",
        input: "http://example.com/foo(really(good)ok)ok",
        expected: ["http://example.com/foo(really(good)ok)ok"]
      },
      ...MARKDOWN_SHARED_TEST_CASES
    ]
  },

  // -------------------------------------------------------------------------
  // 4. AsciiDoc (Strict syntax parsing)
  // -------------------------------------------------------------------------
  {
    format: "strict-asciidoc",
    description: "AsciiDoc",
    cases: [
      {
        input: "https://example.com[Link Text]",
        expected: ["https://example.com"]
      },
      {
        input: "link:https://example.com[Link Text]",
        expected: ["https://example.com"]
      },
      {
        input: "https://example.com[Link Text, window=_blank]",
        expected: ["https://example.com"]
      },
      {
        // Passthrough macro: text is literal
        input: "Pass macro: ++https://example.com++",
        expected: ["https://example.com"]
      },
      {
        // Inline passthrough with plus
        input: "Pass macro with plus: +https://example.com+",
        expected: ["https://example.com"]
      },
      {
        name: "Passthrough macro with double-plus and brackets",
        input: "link:++http://example.org/[path]++[Title]",
        expected: ["http://example.org/[path]"]
      },
      {
        name: "Passthrough macro with single-plus and brackets",
        input: "link:+http://example.org/[path]+[Title]",
        expected: ["http://example.org/[path]"]
      },
      // --- AsciiDoc: Extended Edge Cases ---
      {
        name: "Passthrough with spaces (AsciiDoc allows, regex `.*?` allows)",
        input: "++https://example.com/foo bar++",
        expected: ["https://example.com/foo bar"]
      },
      {
        name: "Stops at [ in standard link",
        input: "http://example.com/foo[text]",
        expected: ["http://example.com/foo"]
      },
      {
        name: "File protocol in AsciiDoc",
        input: "link:file:///C:/local/file.txt[Local File]",
        expected: ["file:///C:/local/file.txt"]
      },
      {
        name: "Passthrough macro matching lazily",
        input: "++http://a.com and http://b.com++",
        expected: ["http://a.com and http://b.com"]
      },
      {
        name: "IPv6 inside standard link",
        input: "http://[2001:db8::1]:8080/path[Link]",
        expected: ["http://[2001:db8::1]:8080/path"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 5. LaTeX (Strict syntax parsing)
  // -------------------------------------------------------------------------
  {
    format: "strict-latex",
    description: "LaTeX",
    cases: [
      {
        input: "\\href{https://example.com}{Link Text}",
        expected: ["https://example.com"]
      },
      {
        input: "\\url{https://example.com}",
        expected: ["https://example.com"]
      },
      {
        input: "Plain text https://example.com inside latex",
        expected: ["https://example.com"]
      },
      // --- LaTeX: Extended Edge Cases ---
      {
        name: "Stops at closing brace",
        input: "\\href{https://example.com/foo}{text}",
        expected: ["https://example.com/foo"]
      },
      {
        name: "Stops at whitespace inside brace (illegal in standard latex but regex might split)",
        input: "\\href{https://example.com/foo bar}{text}",
        // Regex `[^\s<>"'}]+` -> stops at space
        expected: ["https://example.com/foo"]
      },
      {
        name: "File protocol in LaTeX",
        input: "\\url{file:///home/user/document.pdf}",
        expected: ["file:///home/user/document.pdf"]
      },
      {
        name: "Unescaped brace inside URL",
        input: "\\href{http://example.com/a}b}{text}",
        expected: ["http://example.com/a"]
      },
      {
        name: "Quotes inside LaTeX command",
        input: "\\href{http://example.com/foo\"bar}{text}",
        expected: ["http://example.com/foo"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 6. Org Mode (Strict syntax parsing)
  // -------------------------------------------------------------------------
  {
    format: "strict-org-mode",
    description: "Org mode",
    cases: [
      {
        input: "[[https://example.com][Description]]",
        expected: ["https://example.com"]
      },
      {
        input: "[[https://example.com]]",
        expected: ["https://example.com"]
      },
      {
        input: "Escaped brackets: [[https://example.com/foo\\[bar\\]][Desc]]",
        expected: ["https://example.com/foo[bar]"]
      },
      {
        name: "Backslash escaped brackets in URL",
        input: "[[http://example.com/path/\\[brackets\\]][Title]]",
        expected: ["http://example.com/path/[brackets]"]
      },
      // --- Org Mode: Extended Edge Cases ---
      {
        name: "Stops at unescaped closing bracket",
        input: "[[https://example.com/foo]bar]]",
        // Should stop at `]` before `bar`
        expected: ["https://example.com/foo"]
      },
      {
        name: "Handles escaped backslash (literal backslash)",
        input: "[[https://example.com/foo\\\\bar]]",
        // Unescape `\\` -> `\`
        expected: ["https://example.com/foo\\bar"]
      },
      {
        name: "File protocol in Org mode",
        input: "[[file:///etc/fstab][fstab]]",
        expected: ["file:///etc/fstab"]
      },
      {
        name: "IPv6 in Org mode",
        input: "[[http://[2001:db8::1]:8080/path][Desc]]",
        expected: ["http://[2001:db8::1]:8080/path"]
      },
      {
        name: "Multiple consecutive escaped brackets",
        input: "[[http://example.com/\\[\\[foo\\]\\]][Desc]]",
        expected: ["http://example.com/[[foo]]"]
      },
      {
        name: "Escaped bracket at the end of URL",
        input: "[[http://example.com/foo\\]][Desc]]",
        expected: ["http://example.com/foo]"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 7. ReStructuredText (RST)
  // -------------------------------------------------------------------------
  {
    format: "strict-rst",
    description: "ReStructuredText",
    cases: [
      {
        input: "`Link text <https://example.com>`_",
        expected: ["https://example.com"]
      },
      {
        name: "Anonymous hyperlink target (double underscore)",
        input: "`Title <https://example.com/anon>`__",
        expected: ["https://example.com/anon"]
      },
      {
        input: "Standalone https://example.com",
        expected: ["https://example.com"]
      },
      {
        name: "File protocol in RST",
        input: "`Local <file:///etc/hosts>`_",
        expected: ["file:///etc/hosts"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 8. Textile
  // -------------------------------------------------------------------------
  {
    format: "strict-textile",
    description: "Textile",
    cases: [
      {
        input: "\"Link text\":https://example.com",
        expected: ["https://example.com"]
      },
      {
        // Punctuation following the URL
        input: "\"Link\":https://example.com.",
        expected: ["https://example.com"]
      },
      {
        name: "File protocol in Textile",
        input: "\"Local\":file:///etc/hosts",
        expected: ["file:///etc/hosts"]
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 9. MediaWiki
  // -------------------------------------------------------------------------
  {
    format: "strict-mediawiki",
    description: "MediaWiki",
    cases: [
      {
        input: "[https://example.com Link Text]",
        expected: ["https://example.com"]
      },
      {
        input: "[https://example.com]",
        expected: ["https://example.com"]
      },
      {
        name: "File protocol in MediaWiki",
        input: "[file:///etc/hosts Local]",
        expected: ["file:///etc/hosts"]
      }
    ]
  }
];

// --- 3. Unit Tests Suite ---

const UNIT_TESTS = [
  {
    group: "Helpers & Utilities",
    name: "decodeHtmlEntities",
    run: () => {
      assert.strictEqual(decodeHtmlEntities("test&amp;case&lt;&gt;&quot;&#39;"), "test&case<>\"'");
      assert.strictEqual(decodeHtmlEntities(null), null);
    }
  },
  {
    group: "Helpers & Utilities",
    name: "isAllowedProtocol",
    run: () => {
      assert.strictEqual(isAllowedProtocol("http://example.com"), true);
      assert.strictEqual(isAllowedProtocol("https://example.com"), true);
      assert.strictEqual(isAllowedProtocol("file:///path/to/file"), true);
      assert.strictEqual(isAllowedProtocol("about:blank"), false);
      assert.strictEqual(isAllowedProtocol("moz-extension://xyz"), false);
      assert.strictEqual(isAllowedProtocol("ftp://example.com"), false);
      assert.strictEqual(isAllowedProtocol(""), false);
      assert.strictEqual(isAllowedProtocol(null), false);
    }
  },
  {
    group: "Helpers & Utilities",
    name: "escapeLatex",
    run: () => {
      const input = "\\ & % $ # _ { } ~ ^";
      const expected = "\\textbackslash{} \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{}";
      assert.strictEqual(escapeLatex(input), expected);
      assert.strictEqual(escapeLatex("Normal text"), "Normal text");
    }
  },
  {
    group: "Helpers & Utilities",
    name: "decodePunycodeDomain",
    run: () => {
      assert.strictEqual(decodePunycodeDomain("xn--j1ail.xn--p1ai"), "кто.рф");
      assert.strictEqual(decodePunycodeDomain("xn--j1ail.xn--p1ai:8080"), "кто.рф:8080");
      assert.strictEqual(decodePunycodeDomain("example.com"), "example.com");
      assert.strictEqual(decodePunycodeDomain("[2001:db8::1]:80"), "[2001:db8::1]:80");
      assert.strictEqual(decodePunycodeDomain("xn--invalid_punycode"), "xn--invalid_punycode");
      assert.strictEqual(decodePunycodeDomain("sub.xn--j1ail.xn--p1ai"), "sub.кто.рф");
      assert.strictEqual(decodePunycodeDomain("www.xn--mller-kva.de"), "www.müller.de");
    }
  },
  {
    group: "Helpers & Utilities",
    name: "encodeUrlComponent",
    run: () => {
      // Basic encoding of characters not allowed
      assert.strictEqual(encodeUrlComponent("/a b(c)", "/"), "/a%20b%28c%29", "Encodes space and parentheses");
      
      // Allowed characters are preserved
      assert.strictEqual(encodeUrlComponent("/a-b.c", "/"), "/a%2Db%2Ec", "Encodes non-allowed symbols");
      assert.strictEqual(encodeUrlComponent("/a-b.c", "/-."), "/a-b.c", "Preserves explicitly allowed symbols");
      
      // Unicode characters are preserved
      assert.strictEqual(encodeUrlComponent("/你好", "/"), "/你好", "Preserves Unicode letters");
      
      // Handles existing, valid percent-encoding correctly
      assert.strictEqual(encodeUrlComponent("/a%20b", "/"), "/a%20b", "Decodes and re-encodes space");
      
      // Handles malformed URI by encoding the '%'
      assert.strictEqual(encodeUrlComponent("/a%b", "/"), "/a%25b", "Encodes '%' in malformed URI");
    }
  },
  {
    group: "Helpers & Utilities",
    name: "encodeUrlSpecialChars",
    run: () => {
      // Basic URI with spaces
      assert.strictEqual(encodeUrlSpecialChars("https://ex.com/a b"), "https://ex.com/a%20b");
      
      // Unicode preservation
      assert.strictEqual(encodeUrlSpecialChars("https://ex.com/ümlaut"), "https://ex.com/ümlaut");
      
      // Query parameters
      assert.strictEqual(encodeUrlSpecialChars("https://ex.com/?q=hello world&foo=bar"), "https://ex.com/?q=hello%20world&foo=bar");
      
      // Hashes
      assert.strictEqual(encodeUrlSpecialChars("https://ex.com/#section 1"), "https://ex.com/#section%201");
      
      // Encodes non-word special characters that break markup
      assert.strictEqual(encodeUrlSpecialChars("https://ex.com/[test]"), "https://ex.com/%5Btest%5D");
      
      // Fallback for completely invalid URL parsing (e.g., malformed without scheme)
      assert.strictEqual(encodeUrlSpecialChars("invalid url [test]"), "invalid%20url%20%5Btest%5D");

      // IDN / Punycode decoding support
      assert.strictEqual(encodeUrlSpecialChars("https://xn--j1ail.xn--p1ai/path"), "https://кто.рф/path");
      assert.strictEqual(encodeUrlSpecialChars("https://xn--j1ail.xn--p1ai:8080/path"), "https://кто.рф:8080/path");
      
      // Pre-decoded Unicode domain support
      assert.strictEqual(encodeUrlSpecialChars("https://кто.рф/path"), "https://кто.рф/path");
    }
  },
  {
    group: "Formatting Logic",
    name: "getFormatProfile",
    run: () => {
      const mdFormat = getFormatProfile("markdown");
      assert.strictEqual(mdFormat.link("T", "U"), "[T](U)\n\n");
      assert.strictEqual(mdFormat.header("H"), "## H\n\n");

      const plainMdFormat = getFormatProfile("plaintext-markdown-friendly");
      assert.strictEqual(plainMdFormat.link("T", "U"), "T  \nU\n\n");

      const latexFormat = getFormatProfile("latex");
      assert.strictEqual(latexFormat.link("T_1", "U"), "\\href{U}{T\\_1}\n\n");
    }
  },
  {
    group: "Formatting Logic",
    name: "formatTabsToText",
    run: () => {
      const tabs = [
        { url: "https://a.com", title: "Site A" },
        { url: "about:blank", title: "Blank" }, // Should be skipped
        { url: "https://b.com/path", title: "   " } // Empty title fallback
      ];
      const result = formatTabsToText(tabs, "markdown");
      assert.strictEqual(result, "[Site A](https://a.com/)\n\n[b.com/path](https://b.com/path)\n\n");
    }
  },
  {
    group: "Formatting Logic",
    name: "generateWindowHeader",
    run: () => {
      // Empty tabs -> generic header
      assert.strictEqual(generateWindowHeader([], "markdown"), "## window\n\n");

      // Sort logic (frequency, then alphabetical)
      const tabs = [
        { url: "https://c.com" },
        { url: "https://b.com" },
        { url: "https://a.com" },
        { url: "https://b.com" }, // b.com: 2, a.com: 1, c.com: 1
        { url: "about:blank" }    // Ignored
      ];
      // Expected domain order: b.com, a.com, c.com
      assert.strictEqual(generateWindowHeader(tabs, "markdown"), "## b.com, a.com, c.com\n\n");

      // Cutoff after 3 with ellipsis
      const manyTabs = [
        { url: "https://a.com" }, { url: "https://b.com" },
        { url: "https://c.com" }, { url: "https://d.com" }
      ];
      assert.strictEqual(generateWindowHeader(manyTabs, "markdown"), "## a.com, b.com, c.com...\n\n");

      // File handling
      assert.strictEqual(generateWindowHeader([{url: "file:///a.txt"}], "markdown"), "## file\n\n");

      // IDN handling
      assert.strictEqual(generateWindowHeader([{url: "https://xn--j1ail.xn--p1ai"}], "markdown"), "## кто.рф\n\n");
    }
  },
  {
    group: "Parsing Logic",
    name: "isWindowBlank",
    run: () => {
      assert.strictEqual(isWindowBlank([{ url: "about:newtab" }]), true);
      assert.strictEqual(isWindowBlank([{ url: "about:blank" }, { url: "about:home" }]), true);
      assert.strictEqual(isWindowBlank([{ url: "https://example.com" }]), false);
      assert.strictEqual(isWindowBlank([{ url: "about:newtab" }, { url: "https://example.com" }]), false);
    }
  },
  {
    group: "Parsing Logic",
    name: "isWindowDivider",
    run: () => {
      const testCases = [
        // Valid dividers
        { input: "## Header", expected: true, desc: "Markdown ATX" },
        { input: "## ", expected: true, desc: "Markdown ATX empty" },
        { input: "== Header", expected: true, desc: "AsciiDoc ATX" },
        { input: "** Header", expected: true, desc: "Org mode ATX" },
        { input: "h2. Header", expected: true, desc: "Textile ATX" },
        { input: "==Header==", expected: true, desc: "MediaWiki Symmetrical" },
        { input: "\\subsection*{Header}", expected: true, desc: "LaTeX subsection*" },
        { input: "\\subsection{Header}", expected: true, desc: "LaTeX subsection" },
        { input: "---", expected: true, desc: "Setext ---" },
        { input: "===", expected: true, desc: "Setext ===" },
        { input: "~~~", expected: true, desc: "Setext ~~~" },
        { input: "-------", expected: true, desc: "Setext long ---" },
        { input: "=======", expected: true, desc: "Setext long ===" },
        { input: "~~~~~~~", expected: true, desc: "Setext long ~~~" },
        { input: "==", expected: true, desc: "AsciiDoc marker only" },
        { input: "##", expected: true, desc: "Markdown marker only" },
        { input: "**", expected: true, desc: "Org mode marker only" },

        // Invalid/Non-Dividers
        { input: "Just plain text", expected: false, desc: "Plain text" },
        { input: " # Not ATX at start", expected: false, desc: "Space before ATX" },
        { input: "--", expected: false, desc: "Setext -- (too short)" },
        { input: "~~", expected: false, desc: "Setext ~~ (too short)" },
        { input: "--- text", expected: false, desc: "Setext with text" },
        { input: "h2.", expected: false, desc: "Textile ATX marker only" }
      ];

      for (const tc of testCases) {
        const actual = isWindowDivider(tc.input);
        assert.strictEqual(actual, tc.expected, `Failed on: '${tc.input}' ('${tc.desc}')`);
      }
    }
  },
  {
    group: "Parsing Logic",
    name: "parseBatches",
    run: () => {
      const clean = (obj) => JSON.parse(JSON.stringify(obj));

      // 1. No headers, startInCurrentWindow = true -> 1 batch current
      const lines1 = ["https://a.com", "https://b.com"];
      assert.deepStrictEqual(clean(parseBatches(lines1, true, "broad")), [
        { type: "current", urls: ["https://a.com", "https://b.com"] }
      ]);

      // 2. URLs before header, then split -> 2 batches
      const lines2 = ["https://a.com", "## Split", "https://b.com"];
      assert.deepStrictEqual(clean(parseBatches(lines2, true, "broad")), [
        { type: "current", urls: ["https://a.com"] },
        { type: "new", urls: ["https://b.com"] }
      ]);

      // 3. Header first, startInCurrentWindow = false -> goes straight to new window
      const lines3 = ["## Split 1", "https://a.com", "## Split 2", "https://b.com"];
      assert.deepStrictEqual(clean(parseBatches(lines3, false, "broad")), [
        { type: "new", urls: ["https://a.com"] },
        { type: "new", urls: ["https://b.com"] }
      ]);

      // 4. Header first, startInCurrentWindow = true -> first batch goes to current window
      assert.deepStrictEqual(clean(parseBatches(lines3, true, "broad")), [
        { type: "current", urls: ["https://a.com"] },
        { type: "new", urls: ["https://b.com"] }
      ]);

      // 5. Empty lines and multiple dividers
      const lines4 = ["", "## Win 1", "", "https://a.com", "---", "https://b.com"];
      assert.deepStrictEqual(clean(parseBatches(lines4, true, "broad")), [
        { type: "current", urls: ["https://a.com"] },
        { type: "new", urls: ["https://b.com"] }
      ]);
      
      // 6. Divider at the end
      const lines5 = ["https://a.com", "## Win 2"];
      assert.deepStrictEqual(clean(parseBatches(lines5, true, "broad")), [
        { type: "current", urls: ["https://a.com"] },
        { type: "new", urls: [] }
      ]);
      
      // 7. Empty input
      assert.deepStrictEqual(clean(parseBatches([], true, "broad")), [
        { type: "current", urls: [] }
      ]);
    }
  },
  {
    group: "Validation Logic",
    name: "getValidatedFormatId & getValidatedPasteFormatId",
    run: async () => {
      // Empty storage returns default
      resetMockState();
      assert.strictEqual(await getValidatedFormatId(), "plaintext-markdown-friendly");
      assert.strictEqual(await getValidatedPasteFormatId(), "broad");

      // Invalid storage returns default
      mockState.storage = { copyFormat: "invalid-id", pasteFormat: "invalid-id" };
      assert.strictEqual(await getValidatedFormatId(), "plaintext-markdown-friendly");
      assert.strictEqual(await getValidatedPasteFormatId(), "broad");

      // Valid storage returns saved value
      mockState.storage = { copyFormat: "markdown", pasteFormat: "strict-latex" };
      assert.strictEqual(await getValidatedFormatId(), "markdown");
      assert.strictEqual(await getValidatedPasteFormatId(), "strict-latex");
    }
  },
  {
    group: "Core Operations (Integration)",
    name: "copyTabs",
    run: async () => {
      resetMockState();

      // Test Single Window Copy
      mockState.tabsQueried = [
        { url: "https://a.com", title: "A", windowId: 1 }
      ];
      await copyTabs({ currentWindow: true }, "markdown");
      assert.strictEqual(mockState.clipboardText, "[A](https://a.com/)\n\n");

      // Test Multiple Windows Copy
      mockState.tabsQueried = [
        { url: "https://a.com", title: "A", windowId: 1 },
        { url: "https://b.com", title: "B", windowId: 2 }
      ];
      await copyTabs({}, "markdown");
      assert.strictEqual(mockState.clipboardText, "## a.com\n\n[A](https://a.com/)\n\n## b.com\n\n[B](https://b.com/)\n\n");

      // Test Empty Copy
      mockState.tabsQueried = [];
      mockState.clipboardText = "Original";
      await copyTabs({ currentWindow: true }, "markdown");
      assert.strictEqual(mockState.clipboardText, "Original"); // Unchanged
    }
  },
  {
    group: "Core Operations (Integration)",
    name: "pasteTabs",
    run: async () => {
      resetMockState();
      mockState.clipboardText = "Check out https://example.com and https://test.com";
      
      await pasteTabs();
      
      // Should extract both URLs and create tabs for them
      assert.strictEqual(mockState.tabsCreated.length, 2);
      assert.strictEqual(mockState.tabsCreated[0].url, "https://example.com");
      assert.strictEqual(mockState.tabsCreated[1].url, "https://test.com");
    }
  },
  {
    group: "Core Operations (Integration)",
    name: "pasteTabsMultipleWindows",
    run: async () => {
      resetMockState();
      
      // Scenario: Blank starting window
      mockState.tabsQueried = [{ url: "about:newtab" }]; // triggers isWindowBlank -> true
      mockState.clipboardText = "https://1.com\n## Header\nhttps://2.com";
      
      await pasteTabsMultipleWindows();
      
      // https://1.com goes to current window (tabsCreated without windowId)
      assert.strictEqual(mockState.tabsCreated.length, 1);
      assert.strictEqual(mockState.tabsCreated[0].url, "https://1.com");
      
      // https://2.com creates a new window
      assert.strictEqual(mockState.windowsCreated.length, 1);
      assert.strictEqual(mockState.windowsCreated[0].url, "https://2.com");
      
      
      resetMockState();
      
      // Scenario: Non-blank starting window + header first
      mockState.tabsQueried = [{ url: "https://existing.com" }]; // isWindowBlank -> false
      mockState.clipboardText = "## Split 1\nhttps://a.com\nhttps://b.com\n## Split 2\nhttps://c.com";
      
      await pasteTabsMultipleWindows();
      
      // Split 1 creates a new window with a.com, then adds b.com
      assert.strictEqual(mockState.windowsCreated.length, 2);
      assert.strictEqual(mockState.windowsCreated[0].url, "https://a.com");
      
      // First window ID generated is 1
      assert.strictEqual(mockState.tabsCreated.length, 1);
      assert.strictEqual(mockState.tabsCreated[0].url, "https://b.com");
      assert.strictEqual(mockState.tabsCreated[0].windowId, 1);
      
      // Split 2 creates another new window with c.com
      assert.strictEqual(mockState.windowsCreated[1].url, "https://c.com");
    }
  }
];

// --- 4. Test Runner ---

const useColor = !!process.stdout.isTTY;
const clr = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : ""
};

let passed = 0;
let failed = 0;

console.log("\nStarting Test Suites...\n");

// 1. Run URL Extraction Test Suite
for (const group of URL_EXTRACTION_TEST_SUITE) {
  console.log(`${clr.bold}[URL Extraction: ${group.description}]${clr.reset}`);
  
  for (const testCase of group.cases) {
    const caseName = testCase.name || `Input: "${testCase.input}"`;
    try {
      const vmResult = extractUrls(testCase.input, group.format);
      const result = JSON.parse(JSON.stringify(vmResult)); // Strip proxies
      assert.deepStrictEqual(result, testCase.expected);
      passed++;
    } catch (e) {
      console.error(`  ${clr.red}X${clr.reset} ${caseName}`);
      console.error(`    Expected: ${JSON.stringify(testCase.expected)}`);
      
      if (e.code === 'ERR_ASSERTION') {
        console.error(`    Actual:   ${JSON.stringify(e.actual)}`);
      } else {
        console.error(`    Error:    ${e.message}`);
      }
      failed++;
    }
  }
}

// 2. Run Unit Tests Suite
// (We defer execution to the async wrapper below to properly handle async tests
//  and avoid concurrent mutations of the shared mock state.)

// Because some tests are async, we wrap the execution of UNIT_TESTS in an async function
async function runAsyncUnitTests() {
  let currentGroup = null;
  for (const test of UNIT_TESTS) {
    if (currentGroup !== test.group) {
      currentGroup = test.group;
      console.log(`\n${clr.bold}[${currentGroup}]${clr.reset}`);
    }
    
    try {
      await test.run();
      passed++;
    } catch (e) {
      console.error(`  ${clr.red}X${clr.reset} ${test.name}`);
      if (e.code === 'ERR_ASSERTION') {
        console.error(`    Message:  ${e.message}`);
        console.error(`    Expected: ${JSON.stringify(e.expected)}`);
        console.error(`    Actual:   ${JSON.stringify(e.actual)}`);
      } else {
        console.error(`    Error:    ${e.message}`);
      }
      failed++;
    }
  }

  if (failed === 0) {
    console.log(`\n${clr.green}ALL TESTS PASSED${clr.reset} (${passed} tests)`);
    process.exit(0);
  } else {
    console.log(`\n${clr.red}SOME TESTS FAILED${clr.reset} (${failed} failed, ${passed} passed)`);
    process.exit(1);
  }
}

// Better async execution wrapper
(async () => {
  await runAsyncUnitTests();
})();
