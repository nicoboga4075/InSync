let nativePort = null;
let popupPort = null;

function isLinkedinHost(url) {
    return url?.startsWith("https://www.linkedin.com/") ?? false;
}

function updateActionState(tabId, url) {
    if (isLinkedinHost(url)) {
        chrome.action.enable(tabId);
        return;
    }
    chrome.action.disable(tabId);
}

function handlePopupMessage(port, msg) {
    if (msg.command === "handcheck") {
        port.postMessage({
            message: "HANDCHECK_OK"
        });
        return;
    }
    if (msg.command === "install") {
        if (nativePort) {
            nativePort.disconnect();
            nativePort = null;
        }
        nativePort = chrome.runtime.connectNative("com.insync.linkedin");
        nativePort.onMessage.addListener((nativeMsg) => {
            if (popupPort) popupPort.postMessage(nativeMsg);
        });
        nativePort.onDisconnect.addListener(() => {
            if (popupPort) popupPort.postMessage({
                type: "NATIVE_DISCONNECT",
                error: chrome.runtime.lastError?.message || null
            });
            nativePort = null;
        });
        nativePort.postMessage(msg);
    }
}

function handleConnect(port) {
    if (port.name === "popup") {
        popupPort = port;
        port.onDisconnect.addListener(() => {
            popupPort = null;
        });
        port.onMessage.addListener((msg) => handlePopupMessage(port, msg));
    }
}

// Guarded so this file can also be `require()`-d from Node tests, where
// `chrome` doesn't exist. In the real extension, `chrome` is always defined.
if (typeof chrome !== "undefined" && chrome.action) {
    chrome.action.disable();

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status !== "complete" || !tab.url) return;
        updateActionState(tabId, tab.url);
    });

    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
        const tab = await chrome.tabs.get(tabId);
        updateActionState(tabId, tab.url);
    });

    // Connexion from popup
    chrome.runtime.onConnect.addListener(handleConnect);
}

if (typeof module !== "undefined") {
    module.exports = {
        isLinkedinHost,
        updateActionState,
        handlePopupMessage,
        handleConnect
    };
}
