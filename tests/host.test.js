const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const host = require("../host.js");

describe("host.cleanMessage", () => {
    test("returns a default message when empty", () => {
        assert.equal(host.cleanMessage(""), "Unknown error occured");
        assert.equal(host.cleanMessage(undefined), "Unknown error occured");
    });

    test("strips control characters", () => {
        const nul = String.fromCharCode(0x00);
        const unitSeparator = String.fromCharCode(0x1f);
        const del = String.fromCharCode(0x7f);
        assert.equal(host.cleanMessage(`bad${nul}path${unitSeparator}`), "badpath");
        assert.equal(host.cleanMessage(`bad${del}del`), "baddel");
    });

    test("leaves normal text untouched", () => {
        assert.equal(host.cleanMessage("Download failed: 404"), "Download failed: 404");
    });
});

describe("host.formatTime", () => {
    test("formats seconds only", () => {
        assert.equal(host.formatTime(45), "45s");
    });

    test("formats minutes and seconds", () => {
        assert.equal(host.formatTime(125), "2m5s");
    });

    test("formats hours, minutes and seconds", () => {
        assert.equal(host.formatTime(3661), "1h1m1s");
    });

    test("formats an exact number of minutes with no trailing seconds", () => {
        assert.equal(host.formatTime(120), "2m");
    });

    test("formats zero as 0s", () => {
        assert.equal(host.formatTime(0), "0s");
    });
});

describe("host.formatBytes", () => {
    test("formats zero bytes", () => {
        assert.equal(host.formatBytes(0), "0 B");
    });

    test("formats bytes below 1KB", () => {
        assert.equal(host.formatBytes(512), "512.00 B");
    });

    test("formats kilobytes", () => {
        assert.equal(host.formatBytes(2048), "2.00 KB");
    });

    test("formats megabytes", () => {
        assert.equal(host.formatBytes(5 * 1024 * 1024), "5.00 MB");
    });
});
