const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// The scraper logic in popup.js's runScraper() is injected into the LinkedIn
// page via chrome.scripting.executeScript, whose `func` must be fully
// self-contained (Chrome re-serializes it via toString() and cannot close
// over popup.js's module scope). It therefore can't be imported here.
// This test mirrors that inline logic verbatim to guard its behavior -
// keep it in sync with popup.js's injected `getName`/`mostFrequent` if that
// logic changes.
const TITLE_REGEX = /^([^|]*)\|\s*LinkedIn\s*$/;

function mostFrequent(values) {
    const freq = new Map();
    let best = "";
    let bestCount = 0;

    for (const v of values) {
        if (!v) continue;
        freq.set(v, (freq.get(v) || 0) + 1);
    }

    for (const [v, c] of freq.entries()) {
        if (c > bestCount) {
            best = v;
            bestCount = c;
        }
    }
    return best;
}

describe("LinkedIn profile title regex", () => {
    test("extracts the name before ' | LinkedIn'", () => {
        assert.equal(TITLE_REGEX.exec("Jane Doe | LinkedIn")?.[1]?.trim(), "Jane Doe");
    });

    test("tolerates missing/extra spacing around the pipe", () => {
        assert.equal(TITLE_REGEX.exec("Jane Doe|LinkedIn")?.[1]?.trim(), "Jane Doe");
        assert.equal(TITLE_REGEX.exec("Jane Doe  |   LinkedIn")?.[1]?.trim(), "Jane Doe");
    });

    test("does not match titles that aren't LinkedIn profile pages", () => {
        assert.equal(TITLE_REGEX.exec("Just a random page title"), null);
        assert.equal(TITLE_REGEX.exec("Jane Doe | Not LinkedIn"), null);
    });

    test("runs in linear time on adversarial input (no catastrophic backtracking)", () => {
        const adversarial = " ".repeat(50000) + "!";
        const start = Date.now();
        TITLE_REGEX.exec(adversarial);
        assert.ok(Date.now() - start < 200, "regex took too long, possible ReDoS regression");
    });
});

describe("mostFrequent", () => {
    test("returns the most common non-empty value", () => {
        assert.equal(mostFrequent(["Jane Doe", "Jane Doe", "J. Doe"]), "Jane Doe");
    });

    test("ignores falsy values", () => {
        assert.equal(mostFrequent([undefined, "", "Jane Doe"]), "Jane Doe");
    });

    test("returns an empty string when nothing is present", () => {
        assert.equal(mostFrequent([undefined, "", null]), "");
    });

    test("keeps the first value seen on a tie", () => {
        assert.equal(mostFrequent(["A", "B"]), "A");
    });
});
