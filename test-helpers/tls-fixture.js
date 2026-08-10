const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Fixed, admin-owned system directories to resolve openssl from. Never trust
// the inherited PATH for locating the executable: an attacker-writable
// directory placed earlier on PATH could substitute a malicious "openssl".
const TRUSTED_DIRS = process.platform === "win32"
    ? [
        String.raw`C:\Windows\System32`,
        String.raw`C:\Program Files\Git\mingw64\bin`,
        String.raw`C:\Program Files\Git\usr\bin`
    ]
    : ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];

const TRUSTED_PATH = TRUSTED_DIRS.join(path.delimiter);

function resolveOpenssl() {
    const exeName = process.platform === "win32" ? "openssl.exe" : "openssl";
    const found = TRUSTED_DIRS.map(dir => path.join(dir, exeName)).find(p => fs.existsSync(p));
    if (!found) {
        throw new Error("openssl not found in any trusted system directory: " + TRUSTED_DIRS.join(", "));
    }
    return found;
}

// Generates a fresh, ephemeral self-signed cert/key pair for 127.0.0.1 via
// openssl on every call, so no private key material is ever committed to
// the repo. Used only to run a local HTTPS test server (host.js's
// download() hardcodes `https.get`, matching how real tool URLs are https).
function createTlsFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insync-tls-"));
    const keyPath = path.join(dir, "key.pem");
    const certPath = path.join(dir, "cert.pem");
    try {
        const env = { ...process.env, OPENSSL_CONF: "", PATH: TRUSTED_PATH, Path: TRUSTED_PATH };
        execFileSync(resolveOpenssl(), [
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", keyPath,
            "-out", certPath,
            "-days", "1",
            "-subj", "/CN=127.0.0.1",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
        ], {
            stdio: "ignore",
            env
        });
        return {
            key: fs.readFileSync(keyPath, "utf8"),
            cert: fs.readFileSync(certPath, "utf8")
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

module.exports = { createTlsFixture };
