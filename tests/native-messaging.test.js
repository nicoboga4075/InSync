const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

// These tests exercise the real native-messaging host as a subprocess,
// exactly how Chrome launches it via host.cmd: framed length-prefixed JSON
// over stdin/stdout, per the protocol host.js implements.

const HOST_PATH = path.join(__dirname, "..", "host.js");
const PROJECT_ROOT = path.join(__dirname, "..");

function encodeMessage(obj) {
    const json = JSON.stringify(obj);
    const buffer = Buffer.alloc(4 + Buffer.byteLength(json));
    buffer.writeUInt32LE(Buffer.byteLength(json), 0);
    buffer.write(json, 4);
    return buffer;
}

function createFrameReader(onMessage) {
    let buffer = Buffer.alloc(0);
    return (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const len = buffer.readUInt32LE(0);
            if (buffer.length < 4 + len) break;
            const msgText = buffer.slice(4, 4 + len).toString("utf8");
            buffer = buffer.slice(4 + len);
            onMessage(JSON.parse(msgText));
        }
    };
}

function collectMessages(child, expectedCount, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const messages = [];
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for ${expectedCount} message(s); got ${messages.length}: ${JSON.stringify(messages)}`));
        }, timeoutMs);

        child.stdout.on("data", createFrameReader((msg) => {
            messages.push(msg);
            if (messages.length >= expectedCount) {
                clearTimeout(timer);
                resolve(messages);
            }
        }));
        child.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

describe("host.js native messaging protocol", () => {
    test("responds with 'Unknown command' for an unrecognized command", async () => {
        const child = spawn(process.execPath, [HOST_PATH], { cwd: PROJECT_ROOT });
        try {
            const messagesPromise = collectMessages(child, 1);
            child.stdin.write(encodeMessage({ command: "does-not-exist" }));
            const [response] = await messagesPromise;
            assert.equal(response.message, "Unknown command");
        } finally {
            child.kill();
        }
    });

    test("an 'install' command with no configured tools completes immediately", async () => {
        const child = spawn(process.execPath, [HOST_PATH], { cwd: PROJECT_ROOT });
        try {
            const messagesPromise = collectMessages(child, 2);
            child.stdin.write(encodeMessage({ command: "install" }));
            const [installed, disconnect] = await messagesPromise;
            assert.equal(installed.message, "ALL_TOOLS_INSTALLED");
            assert.equal(disconnect.type, "NATIVE_DISCONNECT");
            assert.equal(disconnect.error, null);
        } finally {
            child.kill();
        }
    });

    test("handles a message split across multiple stdin writes", async () => {
        const child = spawn(process.execPath, [HOST_PATH], { cwd: PROJECT_ROOT });
        try {
            const messagesPromise = collectMessages(child, 1);
            const frame = encodeMessage({ command: "split-command" });
            const midpoint = Math.floor(frame.length / 2);
            child.stdin.write(frame.subarray(0, midpoint));
            await new Promise((resolve) => setTimeout(resolve, 50));
            child.stdin.write(frame.subarray(midpoint));
            const [response] = await messagesPromise;
            assert.equal(response.message, "Unknown command");
        } finally {
            child.kill();
        }
    });
});
