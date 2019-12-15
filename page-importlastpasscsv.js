let bg

async function importLastPassCsv() {
	let sites = []
	let lns = docId("sites-ta").value.split("\n")
	for (let ln of lns) {
		if (ln.startsWith("http://sn,")) { // lastpass note
			console.log("ignore sn line:" + ln)
			continue
		}
		if (!ln.startsWith("http://") && !ln.startsWith("https://")) { // support only http:// and https://
			console.log("ignore non-http line:" + ln)
			continue
		}

		let [url, n, p] = ln.split(",", 3)
		if (!url) {
			console.log("ignore empty url line:" + ln)
			continue
		}
		if (!n || !p) {
			console.log("ignore empty name/pw line:" + ln)
			continue
		}
		let h = tidyUrl(url)[1]
		if (!h) {
			console.log("ignore empty host line:" + ln)
			continue
		}

		sites.push([h, n, p])
	}
	if (sites.length == 0) {
		console.log("no sites to import")
		return
	}

	await bg.importSites(sites)
	let tab = await currentTab()
	chrome.tabs.remove(tab.id)
}

async function init() {
	bg = await getBackgroundPage()
	docId("import").addEventListener("click", importLastPassCsv)
}

init()
