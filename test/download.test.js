const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStoredZip } = require("../test-helpers/zip.js");
const { createTlsFixture } = require("../test-helpers/tls-fixture.js");

// host.js only wires up its stdin listener when run as the main module
// (require.main === module), so requiring it here is safe: it won't try
// to consume this test process's stdin.
const host = require("../host.js");

const PLAIN_CONTENT = "fake-tool-binary-content";
const ZIP_TOOL_CONTENT = "fake-extracted-binary";

function download(toolName, tool) {
    host.tools[toolName] = tool;
    return new Promise((resolve, reject) => {
        host.download(toolName, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

describe("host.js download() against a real local HTTPS server", () => {
    let server;
    let baseUrl;
    let tmpDir;
    let previousTlsReject;

    before(async () => {
        // host.js's download() always uses `https.get`, matching how real
        // tool URLs are https. Trust our self-signed test cert for this
        // process only; host.js's own TLS validation is untouched.
        previousTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

        const { key, cert } = createTlsFixture();
        server = https.createServer({ key, cert }, (req, res) => {
            if (req.url === "/plain-tool.exe") {
                res.writeHead(200, { "Content-Type": "application/octet-stream" });
                res.end(PLAIN_CONTENT);
                return;
            }
            if (req.url === "/redirect-once") {
                res.writeHead(302, { Location: `${baseUrl}/plain-tool.exe` });
                res.end();
                return;
            }
            if (req.url === "/redirect-twice") {
                res.writeHead(302, { Location: `${baseUrl}/redirect-once` });
                res.end();
                return;
            }
            if (req.url === "/tool.zip") {
                const zipBuf = createStoredZip([
                    { name: "tool.exe", content: ZIP_TOOL_CONTENT },
                    { name: "unrelated-file.txt", content: "should be ignored" }
                ]);
                res.writeHead(200, { "Content-Type": "application/zip" });
                res.end(zipBuf);
                return;
            }
            if (req.url === "/not-found") {
                res.writeHead(404);
                res.end("nope");
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        baseUrl = `https://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (previousTlsReject === undefined) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsReject;
        }
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "insync-download-test-"));
    });

    test("downloads a plain (non-zip) file to the tool path", async () => {
        const toolPath = path.join(tmpDir, "plain-tool.exe");
        await download("plainTool", { path: toolPath, url: `${baseUrl}/plain-tool.exe` });
        assert.equal(fs.readFileSync(toolPath, "utf8"), PLAIN_CONTENT);
    });

    test("follows HTTP redirects before downloading", async () => {
        const toolPath = path.join(tmpDir, "redirected-tool.exe");
        await download("redirectedTool", { path: toolPath, url: `${baseUrl}/redirect-twice` });
        assert.equal(fs.readFileSync(toolPath, "utf8"), PLAIN_CONTENT);
    });

    test("downloads and extracts only the matching file from a zip", async () => {
        const toolPath = path.join(tmpDir, "tool.exe");
        await download("zippedTool", { path: toolPath, url: `${baseUrl}/tool.zip` });
        assert.equal(fs.readFileSync(toolPath, "utf8"), ZIP_TOOL_CONTENT);
        assert.equal(fs.existsSync(path.join(tmpDir, "unrelated-file.txt")), false);
        assert.equal(fs.existsSync(path.join(tmpDir, "zippedTool.zip")), false, "temp zip should be cleaned up");
    });

    test("creates the destination directory if it doesn't exist yet", async () => {
        const toolPath = path.join(tmpDir, "nested", "dir", "plain-tool.exe");
        await download("nestedTool", { path: toolPath, url: `${baseUrl}/plain-tool.exe` });
        assert.equal(fs.readFileSync(toolPath, "utf8"), PLAIN_CONTENT);
    });

    test("rejects with an error on a non-200 response", async () => {
        const toolPath = path.join(tmpDir, "missing-tool.exe");
        await assert.rejects(
            download("missingTool", { path: toolPath, url: `${baseUrl}/not-found` }),
            /Download failed: 404/
        );
        assert.equal(fs.existsSync(toolPath), false);
    });
});
