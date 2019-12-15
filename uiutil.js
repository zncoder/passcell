function tidyUrl(u) {
	let a = document.createElement("a")
	a.href = u
	return [a.protocol, a.host, a.pathname]
}

function docId(x) {
	return document.getElementById(x)
}

function show(sel) {
	for (let el of document.querySelectorAll(sel)) {
		el.style.display = "block"
	}
}

function hide(sel) {
	for (let el of document.querySelectorAll(sel)) {
		el.style.display = "none"
	}
}

function currentTab() {
	return new Promise(resolve => {
		chrome.tabs.query({active: true, currentWindow: true}, ts => resolve(ts[0]))
	})
}

function sendTabMessage(tab, msg) {
	return new Promise(resolve => {
		chrome.tabs.sendMessage(tab.id, msg, resp => {
			if (chrome.runtime.lastError) {
				console.log("sendtabmessage err:" + chrome.runtime.lastError.message)
				return
			}
			resolve(resp)
		})
	})
}

// https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
function clip(t) {
	let ta = document.createElement("textarea")
	ta.value = t
	ta.style.position = "fixed"
	document.body.appendChild(ta)
	ta.select()
	try {
		document.execCommand("copy")
	} catch (e) {
		console.log("copy to clipboard err"); console.log(e)
	} finally {
		document.body.removeChild(ta)
	}
}

async function clearClipPassword(to) {
	await wait(to)
	console.log("clear password")
	clip("passcell password cleared")
}

function getBackgroundPage() {
	return new Promise(resolve => chrome.runtime.getBackgroundPage(bg => resolve(bg)))
}
