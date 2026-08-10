const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// background.js reads the `chrome` global at require-time (chrome.action.disable())
// and at call-time (chrome.action.enable/disable). A minimal mock stands in for it,
// mirroring how the real extension APIs are shaped.
function createChromeMock() {
    const calls = { enabled: [], disabled: [] };
    return {
        calls,
        chrome: {
            action: {
                disable(tabId) { calls.disabled.push(tabId); },
                enable(tabId) { calls.enabled.push(tabId); }
            },
            tabs: {
                onUpdated: { addListener() {} },
                onActivated: { addListener() {} }
            },
            runtime: {
                onConnect: { addListener() {} }
            }
        }
    };
}

let previousChrome;

beforeEach(() => {
    previousChrome = global.chrome;
});

afterEach(() => {
    global.chrome = previousChrome;
    delete require.cache[require.resolve("../background.js")];
});

describe("background.isLinkedinHost", () => {
    test("accepts LinkedIn profile URLs", () => {
        const { chrome } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        assert.equal(background.isLinkedinHost("https://www.linkedin.com/in/jane-doe/"), true);
    });

    test("rejects other hosts", () => {
        const { chrome } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        assert.equal(background.isLinkedinHost("https://example.com/"), false);
    });

    test("rejects undefined/empty URLs", () => {
        const { chrome } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        assert.equal(background.isLinkedinHost(undefined), false);
        assert.equal(background.isLinkedinHost(""), false);
    });
});

describe("background.updateActionState", () => {
    test("enables the action on a LinkedIn tab", () => {
        const { chrome, calls } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        // Loading the module calls chrome.action.disable() once (no tabId) to
        // start the toolbar icon disabled; ignore that load-time call here.
        calls.enabled.length = 0;
        calls.disabled.length = 0;
        background.updateActionState(7, "https://www.linkedin.com/in/jane-doe/");
        assert.deepEqual(calls.enabled, [7]);
        assert.deepEqual(calls.disabled, []);
    });

    test("disables the action on a non-LinkedIn tab", () => {
        const { chrome, calls } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        calls.enabled.length = 0;
        calls.disabled.length = 0;
        background.updateActionState(7, "https://example.com/");
        assert.deepEqual(calls.enabled, []);
        assert.deepEqual(calls.disabled, [7]);
    });
});

describe("background.handlePopupMessage", () => {
    test("answers a handcheck with HANDCHECK_OK", () => {
        const { chrome } = createChromeMock();
        global.chrome = chrome;
        const background = require("../background.js");
        const sent = [];
        const port = { postMessage: (msg) => sent.push(msg) };
        background.handlePopupMessage(port, { command: "handcheck" });
        assert.deepEqual(sent, [{ message: "HANDCHECK_OK" }]);
    });

    test("opens a native connection and forwards the install message", () => {
        const { chrome } = createChromeMock();
        const nativeMessages = [];
        chrome.runtime.connectNative = (name) => {
            assert.equal(name, "com.insync.linkedin");
            return {
                onMessage: { addListener() {} },
                onDisconnect: { addListener() {} },
                postMessage: (msg) => nativeMessages.push(msg)
            };
        };
        global.chrome = chrome;
        const background = require("../background.js");
        const port = { postMessage() {} };
        background.handlePopupMessage(port, { command: "install" });
        assert.deepEqual(nativeMessages, [{ command: "install" }]);
    });
});
