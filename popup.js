let analysisHadError = false;

const bgPort = chrome.runtime.connect({
    name: "popup"
});

function cleanMessage(message) {
    return (message || "Unknown error occured").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

bgPort.onMessage.addListener((msg) => {
    if (msg.message === "HANDCHECK_OK") {
        outputTerminal.value = "> Waiting for you.\n";
        statusTerminal.textContent = `Status: Idle`;
        return;
    }
    if (msg.type === "NATIVE_DISCONNECT") {
        if (msg.error) {
            outputTerminal.value += "> " + cleanMessage(msg.error) + "\n";
            statusTerminal.textContent = `Status: Error`;
            hideProgress();
        } else {
            statusTerminal.textContent = analysisHadError ? `Status: Error` : `Status: Success`;
        }
		analysisHadError = false;
        scanBtn.disabled = false;
        return;
    }
    if (msg.message === "ALL_TOOLS_INSTALLED") {
        statusTerminal.textContent = `Status: Tools installation finished`;
        let lines = outputTerminal.value.split("\n");
        lines.shift();
        outputTerminal.value = lines.join("\n");
        outputTerminal.value += "\n";
        return;
    }
    if (msg.message) {
        outputTerminal.value += "> " + cleanMessage(msg.message) + "\n";
        outputTerminal.scrollTop = outputTerminal.scrollHeight;
    }
});

bgPort.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
        outputTerminal.value += "> " + cleanMessage (chrome.runtime.lastError.message) + "\n";
        statusTerminal.textContent = `Status: Error`;
        fetch(chrome.runtime.getURL("host.log"))
            .then(res => res.text())
            .then(text => {
                const lines = text.trim().split("\n");
                const lastRecord = lines.at(-1);
                if (lastRecord.toLowerCase().includes('node') || lastRecord.includes('fichier de commandes.') || lastRecord.includes('batch file.')) {
                    outputTerminal.value += "> Check if Node.js is installed and well recognized or used on your laptop.\n";
                }
            });
    } else {
        statusTerminal.textContent = `Status: Idle`;
    }
    scanBtn.disabled = false;
});

bgPort.postMessage({
    command: "handcheck"
});

function showProgress(label, percent, meta) {
    progressContainer.style.display = "block";
    progressLabel.textContent = label;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    progressMeta.textContent = meta || "";
}

function hideProgress() {
    progressContainer.style.display = "none";
    progressBar.style.width = "0%";
}

async function runScraper() {
    try {
		hideProgress();
        scanBtn.disabled = true;
        outputTerminal.value = "\n";
        statusTerminal.textContent = `Status: Scanning`;
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
		chrome.runtime.onMessage.addListener((msg) => {
			if (msg.type === "SCRAPER_PROGRESS") {
				showProgress(
					msg.label || "",
					msg.percent ?? 0,
					msg.meta || ""
				);
				statusTerminal.textContent = "Status: Analysing...";
			}
		});
        chrome.scripting.executeScript({
            target: {
                tabId: tab.id
            },
            args: [tab.url],
            func: (tabUrl) => {
                return new Promise((resolve, reject) => {
					const cleanMessage = (message) => (message || "...").normalize("NFKD").replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
					
                    try {			
                        const main = document.querySelector("main");
                        main.scrollTo({ top: 0 });

                        let lastHeight = 0;
                        let idleRounds = 0;
                        const checkInterval = 500;
                        const maxIdleRounds = 10;
						
						const sendProgress = (label, percent, meta) => {
							chrome.runtime.sendMessage({
								type: "SCRAPER_PROGRESS",
								label,
								percent,
								meta
							});
						};
						
						sendProgress("Brainstorming...", 0);
						
                        const mostFrequent = (values) => {
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
                        };

                        const getAnalysisZone = () =>
                            document.querySelector('[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"]');

                        const getMain = () =>
                            getAnalysisZone()?.querySelector("main#workspace");

                        const getToolBar = () =>
                            getAnalysisZone()?.querySelector('div[role="toolbar"]');

                        const getTopCard = () =>
                            getMain()?.querySelector('section[componentkey$="Topcard"]');

                        const hasVerifiedProfile = () =>
                            getTopCard()?.querySelector('svg[id*="verified"]') !== null;

                        const getTitleDescription = () =>
                            getToolBar()?.querySelectorAll("p")?.[1]?.textContent || "";

                        const getName = () => {
                            const values = [
                                /^([^|]*)\|\s*LinkedIn\s*$/.exec(document.title)?.[1]?.trim(),
                                getToolBar()?.querySelector('a')?.firstElementChild?.ariaLabel?.trim(),
                                getToolBar()?.querySelectorAll('p')?.[0]?.textContent?.trim(),
                                getTopCard()?.querySelector('h2')?.textContent?.trim()
                            ];
                            return mostFrequent(values);
                        };

                        const step = () => {
							try {

								main.scrollTo({
									top: main.scrollHeight,
									behavior: "smooth"
								});

								const newHeight = document.documentElement.scrollHeight;

								if (newHeight === lastHeight) {
									idleRounds++;
								} else {
									idleRounds = 0;
									lastHeight = newHeight;
								}

								if (idleRounds < maxIdleRounds) {
									sendProgress("", Number.parseInt(idleRounds*100/maxIdleRounds));
									setTimeout(step, checkInterval);
								} else {
									resolve({
										url: tabUrl,
										name: getName(),
										titleDescription: getTitleDescription(),
										verified: hasVerifiedProfile()
									});	
									sendProgress("Completed", 100);									
								}
							} catch (err) {
								reject(cleanMessage(err.message));
							}
						};
                        step();
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        }, ([{ result }]) => {
            scanBtn.disabled = false;
            if (chrome.runtime.lastError) {
                analysisHadError = true;
                outputTerminal.value = "> " + cleanMessage(chrome.runtime.lastError.message) + "\n";
                statusTerminal.textContent = `Status: Error`;
                return;
            }
            if (!result) {
                analysisHadError = true;
                outputTerminal.value = "> Unexpected error occured while analysing.\n";
                statusTerminal.textContent = `Status: Error`;
                return;
            }
            window.scraperResults = result;
            outputTerminal.value = JSON.stringify(window.scraperResults, null, 2);
            statusTerminal.textContent = `Status: Analysis finished`;
        });
    } catch (err) {
        outputTerminal.value += "> " + cleanMessage(err.message) + "\n";
        statusTerminal.textContent = `Status: Error`;
        scanBtn.disabled = false;
    }
}

closeBtn.addEventListener("click", () => {window.close()});

scanBtn.addEventListener("click", () => {runScraper()});