# CLAUDE.md

## Project

InSync is a Chrome extension (Manifest V3) that scrapes the LinkedIn profile in the active tab (name, headline, verified badge) directly from the DOM, with no LinkedIn API.
It pairs with a Windows-only Node.js native messaging host (`host.cmd` → `host.js`) that downloads and unzips local companion tools and streams progress back to the popup.
CI runs on GitHub Actions, with Codecov for coverage and SonarCloud for quality. The project is in beta.

## Stack

| Area | Tools (major version) |
|---|---|
| Runtime | Node.js 22.23.3 (`.nvmrc`, read by the coverage job; CI build matrix `lts/iron` (20), `lts/jod` (22) and `lts/krypton` (24); `host.cmd` installs the same version when missing), npm |
| Extension | Chrome Manifest V3, Vanilla JS (CommonJS), HTML 5, CSS 3, Terser 5 |
| Host | Node.js built-ins (`https`, `child_process`, `fs`), unzipper 0 |
| Tests | `node:test` runner, `node:assert/strict`, c8 12 |
| Release | auto-changelog 2 |

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Wipe `dist/` and minify every root `.js` into it with terser. Required after any edit to `background.js` or `popup.js`: `manifest.json` loads `dist/background.js` and `popup.html` loads `dist/popup.js` (`host.cmd` runs the root `host.js` directly) |
| `npm test` | Every test (`node --test`, discovers `tests/*.test.js`) |
| `node --test tests/host.test.js` | One test file; add `--test-name-pattern="formatTime"` for one test |
| `npm run test:coverage` | c8 with lcov and text reporters (`coverage/lcov.info`) |
| `npm run changelog` | Regenerate `CHANGELOG.md` |
| `npm run release -- [patch\|minor\|major\|x.y.z]` | Bump the version, regenerate `CHANGELOG.md` (template `changelog.hbs`), run `update-version.js` (version and date in `popup.html` and `CHANGELOG.md`), then **commit, tag and push**. Never run it unless asked |

No linter is configured.

## Environment and setup

- Node.js of `.nvmrc` (22.23.3; 20 or later works), then `npm ci`.
- Always use an LTS version of Node.js for the builds and the tests (`.nvmrc`, the GitHub workflows, `host.cmd`), never a Current (odd) release; Node 20, past its end of life, stays in the CI build matrix as `lts/iron` (its last LTS release, 20.20.2) for backward compatibility only.
- Windows only: `host.cmd` and `com.insync.linkedin.json` hard-code `C:\InSync`.
- `npm run build`, then load the folder unpacked from `chrome://extensions` (Developer mode).
- Native host registration: the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.insync.linkedin` points to `com.insync.linkedin.json`, whose `allowed_origins` must match the loaded extension ID.
- `host.cmd` resolves Node (PATH → nvm in `%LOCALAPPDATA%\nvm` → portable Node 22.23.3 download into `%LOCALAPPDATA%\Programs\nodejs`); `host.js` runs `npm install` on start if `node_modules/` is missing.
- Logs: `host.log` (written by `host.js`), `stdio.log` (stderr and Node version, written by `host.cmd`).

## Architecture

Message flow: `popup.js` ⇄ (`chrome.runtime.connect`, port `"popup"`) ⇄ `background.js` ⇄ (`chrome.runtime.connectNative("com.insync.linkedin")`) ⇄ `host.cmd` → `host.js`.

- **`background.js`** (service worker): enables the action icon only on `https://www.linkedin.com/*`; answers `{command: "handcheck"}` with `HANDCHECK_OK`; on `{command: "install"}` opens a fresh native port and relays every native message to the popup, emitting `{type: "NATIVE_DISCONNECT", error}` on disconnect.
- **`popup.js`**: UI logic plus the scraper. The scraper is the `func` passed to `chrome.scripting.executeScript`: it is serialized and run in the LinkedIn page, so it **must stay self-contained** (inputs go through `args`, helpers like `cleanMessage` are redefined inside it). It auto-scrolls the profile to load lazy content and reports progress with `chrome.runtime.sendMessage({type: "SCRAPER_PROGRESS", label, percent, meta})`.
- **`host.js`**: Chrome native messaging over stdio (4-byte little-endian length prefix + UTF-8 JSON, both ways). Messages are handled one at a time through the `messageQueue` promise. `install` walks the `tools` map (`{name: {path, url}}`, currently empty), downloads over HTTPS following redirects, extracts the matching entry of a `.zip`, then sends `ALL_TOOLS_INSTALLED` and `NATIVE_DISCONNECT`. **stdout is reserved for the protocol**: diagnostics go through `log()` to `host.log`.

## Code conventions

- Plain CommonJS, 4-space indentation, double quotes, semicolons, `const`/`let` (no `var`).
- Every source file must stay `require()`-able from Node without Chrome: touch `chrome` only inside `typeof chrome !== "undefined"` guards, export functions through `if (typeof module !== "undefined") module.exports = …`, and keep `host.js` side effects behind `require.main === module`.
- A message type or command changed on one side (`popup.js`, `background.js`, `host.js`) must be changed on the others.
- Files normalized by `.gitattributes` (`text=auto`).
- Comments: see "Comments" below.

## Git workflow

- One branch, `main`. Commit only when asked, and never push until asked.
- `origin` is GitHub (`nicoboga4075/InSync`); Dependabot opens daily npm update PRs.
- Each push and PR to `main` runs `.github/workflows/node.js.yml`: the `build` job runs `npm ci --ignore-scripts`, build and tests on `lts/iron`, `lts/jod` and `lts/krypton`; then the `coverage` job, on the Node.js of `.nvmrc`, writes the coverage to the job summary and uploads it to Codecov (OIDC). SonarCloud uses automatic analysis (`.sonarcloud.properties`, excludes `dist/` and `tests/`).
- Releases: `npm run release` (see "Commands").

## Tests

- One file per area in `tests/`, run under plain Node with `node:test`.
- `background.test.js` and `popup.test.js` install plain-object mocks of `chrome` and of the popup DOM elements (bare globals, the ids reflected on `window`) on `global`, and clear `require.cache` between tests.
- `native-messaging.test.js` spawns `host.js` as a real subprocess and talks the framed protocol; `download.test.js` uses a local HTTPS server (`tests/helpers/tls-fixture.js`) and an in-memory zip builder (`tests/helpers/zip.js`).
- `linkedin-title-parser.test.js` **duplicates** the injected scraper's title parsing (`getName`, `mostFrequent`) because it cannot be imported: change both together.

## Sensitive areas

- `extension.pem` (signing key) and `extension.crx` are git-ignored: never commit, copy or share them.
- `com.insync.linkedin.json` pins the allowed extension ID: changing it breaks the native host for the installed extension.
- `host.cmd` downloads and runs Node, and `host.js` downloads and writes executables: any URL or path change there needs care (HTTPS only, the extracted entry matched by name).
- Never edit `dist/` (generated) or hand-edit the version in `popup.html` and `CHANGELOG.md` (written by `npm run release`).
- `host.log`, `stdio.log` and `Benchmark.docx` are local files, git-ignored.

## Glossary

| Term | Meaning |
|---|---|
| host, native host | `host.js` launched by Chrome through `host.cmd`, registered as `com.insync.linkedin` |
| handcheck | The popup's first message to `background.js`, answered with `HANDCHECK_OK` |
| install | The command relayed to the host that installs the missing companion tools |
| tools | The `tools` map of `host.js`: companion tools to download (`path`, `url`) |
| scan | The **SCAN** button run: inject the scraper, scroll, read the profile |
| frame | A native message: 4-byte little-endian length, then the JSON |

## Commits

Start every commit message with the emoji from [gitmoji.dev](https://gitmoji.dev) that matches the change, as the character itself (not the `:code:`), followed by a space and the subject line. For example:

- `🐛 Fix ...` for a bug fix
- `✨ Add ...` for a new feature
- `💄 Update ...` for UI and style changes
- `♿️ Improve ...` for accessibility
- `♻️ Refactor ...` for a refactor
- `✅ Test ...` for adding or updating tests
- `👷 Update ...` for the CI workflows
- `📝 Document ...` for documentation
- `🔧 Configure ...` for configuration files

One emoji per commit: pick the one for the main intent of the change. The `Release vX.Y.Z` commits created by `npm run release` keep their format, since `auto-changelog` excludes them through `ignoreCommitPattern: "^Release v"`.

## Comments

Prefer single-line comments, even long ones, in every language (JS, HTML, CSS, batch): no comment wrapped over several lines, and no numbered lists (`1.`, `2.`) inside a comment. When a comment explains several cases or branches, put one single-line comment on each branch instead of a block above them.

## File size

**Never commit a file of 100 MB or more, whatever the reason.** GitHub refuses any file over 100 MiB, so one such file blocks every push. Git warns from 50 MiB: keep each file well under that, and never commit downloaded companion tools or runtime logs (`host.log`, `stdio.log`).
