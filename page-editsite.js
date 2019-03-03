let bg
getBackgroundPage()
	.then(x => {
		bg = x
		bg.ready().then(() => hydrateSites())
	})

let lastIndex = 0

const acctTmpl = '<td><span id="host-{id}">{host}</span></td>\n\
<td><span id="name-{id}">{name}</span></td>\n\
<td><span id="pw-sp-{id}">******</span><input type="hidden" value="{pw}" id="pw-{id}"></td>\n\
<td><img id="editimg_{id}" src="icons/edit.png" />&nbsp;&nbsp;<img id="delimg_{id}" src="icons/delete.png" /></td>'

function hydrateSites() {
	let sites = bg.getSites()

	let tb = docId("sites-tb")
	for (let i = 0; i < sites.length; i++) {
		let x = sites[i]
		let host = x[0]
		let name = x[1]
		let pw = x[2]

		lastIndex++
		let j = lastIndex

		let acct = document.createElement("tr")
		acct.id = "row-"+j
		acct.classList.add("acct_row")
		acct.innerHTML = acctTmpl.replace(/{host}/g, host)
			.replace(/{id}/g, j+"")
			.replace(/{name}/g, name)
			.replace(/{pw}/g, pw)
		tb.appendChild(acct)
		
		docId("editimg_"+j).addEventListener("click", () => toggleEdit(j))
		docId("delimg_"+j).addEventListener("click", () => deleteEntry(j))
	}

	docId("save").addEventListener("click", () => saveSites())
}

function toggleEdit(i) {
	if (docId("host-"+i).contentEditable !== "true") {
		docId("row-"+i).style.backgroundColor = "yellow"
		docId("host-"+i).contentEditable = "true"
		docId("name-"+i).contentEditable = "true"
		let pwsp = docId("pw-sp-"+i)
		pwsp.contentEditable = "true"
		pwsp.innerText = docId("pw-"+i).value
		docId("editimg_"+i).src = "icons/ok.png"
	} else {
		docId("row-"+i).style.backgroundColor = ""
		docId("host-"+i).contentEditable = "false"
		docId("name-"+i).contentEditable = "false"
		let pwsp = docId("pw-sp-"+i)
		pwsp.contentEditable = "false"
		docId("pw-"+i).value = pwsp.innerText
		pwsp.innerText = "******"
		docId("editimg_"+i).src = "icons/edit.png"
	}
}

function deleteEntry(i) {
	let el = docId("row-"+i)
	el.parentNode.removeChild(el)
}

function saveSites() {
	let sites = []
	let trs = document.getElementsByTagName("tr")
	for (let tr of trs) {
		if (!tr.id.startsWith("row-")) {
			continue
		}
		let j = tr.id.substring(4)
		
		let host = docId("host-"+j)
		if (host.contentEditable === "true") {
			alert("host:"+h+" is in editing mode")
			return
		}
		let h = host.innerText
		let n = docId("name-"+j).innerText
		let p = docId("pw-"+j).value
		if (h === "" || n === "" || p === "") {
			continue
		}
		sites.push([h, n, p])
	}

	bg.resetSites(sites).then(() => {
		//window.location.reload(false)
		chrome.tabs.query({active: true}, (tbs) => {
			chrome.tabs.remove(tbs[0].id)
		})
	})
}
