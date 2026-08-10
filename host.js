const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const logFile = String.raw`C:\InSync\host.log`;
const tools = {};

function log(msg) {
    try {
        const dir = path.dirname(logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true
            });
        }
        if (!fs.existsSync(logFile)) {
            fs.writeFileSync(logFile, "");
        }
        fs.appendFileSync(logFile, new Date().toISOString() + " " + (typeof msg === "string" ? msg : JSON.stringify(msg)) + "\n", {
            encoding: 'utf8'
        });
    } catch (err) {
        console.error("Log write failed: " + err.message);
        return false;
    }
}

function cleanMessage(message) {
    return (message || "Unknown error occured").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

log("Host started");

const { execSync, execFile } = require("node:child_process");
if (!require("node:fs").existsSync("node_modules")) {
    log("Installing dependencies...");
    execSync("npm install --no-audit --no-fund", {
        stdio: "ignore"
    });
}
const unzipper = require("unzipper");
const util = require("node:util");
const execAsync = util.promisify(execFile);

function sendResponse(obj) {
    const json = JSON.stringify(obj);
    const buffer = Buffer.alloc(4 + Buffer.byteLength(json));
    buffer.writeUInt32LE(Buffer.byteLength(json), 0);
    buffer.write(json, 4);
    process.stdout.write(buffer);
    log("Response sent: " + json);
}

function fetchFollowingRedirects(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                log(`Redirect ${res.statusCode} -> ${res.headers.location}`);
                resolve(fetchFollowingRedirects(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error("Download failed: " + res.statusCode));
                return;
            }
            resolve(res);
        }).on("error", reject);
    });
}

function saveResponseToFile(res, filePath) {
    return new Promise((resolve, reject) => {
        let file;
        try {
            file = fs.createWriteStream(filePath);
        } catch (err) {
            reject(err);
            return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
    });
}

function extractZipEntry(entry, toolPath) {
    if (entry.path.endsWith(path.basename(toolPath))) {
        entry.pipe(fs.createWriteStream(toolPath));
    } else {
        entry.autodrain();
    }
}

function extractFromZip(zipPath, toolPath) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
            .pipe(unzipper.Parse())
            .on("entry", entry => extractZipEntry(entry, toolPath))
            .on("close", resolve)
            .on("error", reject);
    });
}

async function download(toolName, callback) {
    const tool = tools[toolName];
    const toolPath = tool.path;
    const toolUrl = tool.url;
    const isZip = toolUrl.endsWith(".zip");
    const dir = path.dirname(toolPath);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
        recursive: true
    });

    const tempFile = isZip ? path.join(dir, toolName + ".zip") : toolPath;

    log(`Downloading ${toolName} from ${toolUrl}`);
    sendResponse({
        message: `Starting download of ${toolName}...`
    });

    let res;
    try {
        res = await fetchFollowingRedirects(toolUrl);
    } catch (err) {
        log("Download error: " + cleanMessage(err.message));
        fs.unlink(tempFile, () => callback(err));
        return;
    }

    try {
        await saveResponseToFile(res, tempFile);
    } catch (err) {
        log("File stream error: " + cleanMessage(err.message));
        callback(err);
        return;
    }

    log("Download finished: " + tempFile);

    if (!isZip) {
        sendResponse({
            message: `${toolName} successfully installed`
        });
        callback(null);
        return;
    }

    log(`Extracting ${toolName} from zip`);
    try {
        await extractFromZip(tempFile, toolPath);
    } catch (err) {
        callback(err);
        return;
    }
    if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
    }
    sendResponse({
        message: `${toolName} successfully installed`
    });
    log(`${toolName} extracted to ${toolPath}`);
    callback(null);
}

function installIfNotExists(toolName, callback) {
    const exePath = tools[toolName].path;
    log(`Checking if ${toolName} exists at ${exePath}`);
    if (fs.existsSync(exePath)) {
        sendResponse({
            message: `${toolName} already installed`
        });
        return callback();
    }
    download(toolName, (err) => {
        if (err) {
            const errorMessage = cleanMessage(err.message);
            sendResponse({
                message: `Error installing ${toolName}: ${errorMessage}`
            });
            log(`Installation failed for ${toolName}: ${errorMessage}`);
        }
        callback();
    });
}

function installAllTools() {
    return new Promise((resolve, reject) => {
        try {
            const toolsList = Object.keys(tools);
            let index = 0;
            function next() {
                if (index >= toolsList.length) {
                    sendResponse({
                        message: "ALL_TOOLS_INSTALLED"
                    });
                    resolve();
                    return;
                }
                try {
                    installIfNotExists(toolsList[index++], (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            next();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            }
            next();
        } catch (err) {
            reject(err);
        }
    });
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    let result = "";
    if (hours > 0) result += `${hours}h`;
    if (minutes > 0) result += `${minutes}m`;
    if (remainingSeconds > 0 || result === "") result += `${remainingSeconds}s`;
    return result;
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
        const msgLength = buffer.readUInt32LE(0);
        if (buffer.length < 4 + msgLength) break;
        const msgBuffer = buffer.slice(4, 4 + msgLength);
        const msgText = msgBuffer.toString("utf8");
        buffer = buffer.slice(4 + msgLength);
        try {
            const msg = JSON.parse(msgText);
            log("Message: " + JSON.stringify(msg));
            if (msg.command === "install") {
                await installAllTools();
                sendResponse({
                    type: "NATIVE_DISCONNECT",
                    error: null
                });
            } else {
                log("Unknown command received");
                sendResponse({
                    message: "Unknown command"
                });
            }
        } catch (err) {
            log("JSON parse error: " + cleanMessage(err.message));
        }
    }
});