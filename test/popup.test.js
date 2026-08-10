const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// popup.js reads DOM elements as bare globals (the browser reflects each id
// attribute onto `window`), and `chrome` for messaging. Plain objects mimic
// both here so the module can be loaded and exercised under plain Node.
function createElement(overrides = {}) {
    return Object.assign({ style: {}, textContent: "", value: "", disabled: false, addEventListener() {} }, overrides);
}

function createPortMock() {
    return {
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage() {}
    };
}

function installDomMocks() {
    global.progressContainer = createElement();
    global.progressLabel = createElement();
    global.progressPercent = createElement();
    global.progressBar = createElement();
    global.progressMeta = createElement();
    global.outputTerminal = createElement();
    global.statusTerminal = createElement();
    global.scanBtn = createElement();
    global.closeBtn = createElement();
    global.window = { close() {} };
}

function clearDomMocks() {
    for (const name of ["progressContainer", "progressLabel", "progressPercent", "progressBar", "progressMeta", "outputTerminal", "statusTerminal", "scanBtn", "closeBtn", "chrome", "window"]) {
        delete global[name];
    }
    delete require.cache[require.resolve("../popup.js")];
}

describe("popup.cleanMessage", () => {
    beforeEach(installDomMocks);
    afterEach(clearDomMocks);

    test("returns a default message when empty", () => {
        const popup = require("../popup.js");
        assert.equal(popup.cleanMessage(""), "Unknown error occured");
    });

    test("strips control characters", () => {
        const popup = require("../popup.js");
        const nul = String.fromCharCode(0x00);
        assert.equal(popup.cleanMessage(`bad${nul}path`), "badpath");
    });
});

describe("popup.showProgress / hideProgress", () => {
    beforeEach(installDomMocks);
    afterEach(clearDomMocks);

    test("showProgress fills in label, percent and bar width", () => {
        const popup = require("../popup.js");
        popup.showProgress("Scrolling...", 42, "3 / 10");
        assert.equal(global.progressContainer.style.display, "block");
        assert.equal(global.progressLabel.textContent, "Scrolling...");
        assert.equal(global.progressPercent.textContent, "42%");
        assert.equal(global.progressBar.style.width, "42%");
        assert.equal(global.progressMeta.textContent, "3 / 10");
    });

    test("showProgress defaults meta to an empty string", () => {
        const popup = require("../popup.js");
        popup.showProgress("Working", 10);
        assert.equal(global.progressMeta.textContent, "");
    });

    test("hideProgress hides the bar and resets its width", () => {
        const popup = require("../popup.js");
        popup.showProgress("Working", 10);
        popup.hideProgress();
        assert.equal(global.progressContainer.style.display, "none");
        assert.equal(global.progressBar.style.width, "0%");
    });
});

describe("popup.runScraper", () => {
    beforeEach(installDomMocks);
    afterEach(clearDomMocks);

    test("disables the scan button, clears output, and reports the scraped result", async () => {
        const scrapedResult = {
            url: "https://www.linkedin.com/in/jane-doe/",
            name: "Jane Doe",
            titleDescription: "Senior Software Engineer",
            verified: true
        };
        let executeScriptOptions;
        global.chrome = {
            tabs: {
                query: async () => [{ id: 1, url: "https://www.linkedin.com/in/jane-doe/" }]
            },
            runtime: {
                connect: createPortMock,
                onMessage: { addListener() {} }
            },
            scripting: {
                executeScript: (options, callback) => {
                    executeScriptOptions = options;
                    callback([{ result: scrapedResult }]);
                }
            }
        };
        const popup = require("../popup.js");

        await popup.runScraper();

        assert.equal(global.scanBtn.disabled, false);
        assert.equal(executeScriptOptions.target.tabId, 1);
        assert.deepEqual(executeScriptOptions.args, ["https://www.linkedin.com/in/jane-doe/"]);
        assert.equal(global.statusTerminal.textContent, "Status: Analysis finished");
        assert.deepEqual(JSON.parse(global.outputTerminal.value), scrapedResult);
    });

    test("reports an error status when the scraper returns nothing", async () => {
        global.chrome = {
            tabs: {
                query: async () => [{ id: 1, url: "https://www.linkedin.com/in/jane-doe/" }]
            },
            runtime: {
                connect: createPortMock,
                onMessage: { addListener() {} }
            },
            scripting: {
                executeScript: (options, callback) => callback([{ result: undefined }])
            }
        };
        const popup = require("../popup.js");

        await popup.runScraper();

        assert.equal(global.statusTerminal.textContent, "Status: Error");
        assert.match(global.outputTerminal.value, /Unexpected error occured/);
    });
});
