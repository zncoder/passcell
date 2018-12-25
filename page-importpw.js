function importSites() {
	let sites = [];
	let trs = document.getElementsByTagName('tr');
	for (let tr of trs) {
		if (tr.children[0].nodeName == 'TH') {
			continue;
		}
		let u = tr.children[0].innerText;
		let n = tr.children[1].innerText;
		let p = tr.children[2].innerText;
		sites.push([u, n, p]);
	}
	//console.log("to import sites"); console.log(sites);
	return sites;
}

chrome.runtime.sendMessage({
	action: "import",
	sites: importSites()
});
