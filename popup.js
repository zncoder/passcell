let bg = null

let autoSubmitBlacklist = new Set([
	"login.fidelity.com",
	"online.citi.com",
])

let hiddenWhitelist = new Set([
	"online.citi.com",
])

getBackgroundPage()
	.then(x => {
		bg = x
		loadPage()
	})
	.catch(e => { console.log("popup err"); console.log(e); })

function loadPage() {
	//console.log("openpopup")
	hide(".page")

	// already opened
	if (bg.opened()) {
		show("#site_sec")
		hide("#oldaccts_sec")
		show("#shownewacct_sec")
		hide("#status_sec")
		hide("#newacctdetail_sec")
		hide("#editacctdetail_sec")
		docId("shownewacct_acct").addEventListener("click", showNewAccount)
		currentTab().then(tab => hydrateSitePage(tidyUrl(tab.url)))
		return
	}

	// log in to existing account
	if (bg.isOldAccount()) {
		showLogIn()
		return
	}

	// choose signup or login
	show("#choose_sec")
	docId("do_signup_btn").addEventListener("click", showSignUp)
	docId("do_login_btn").addEventListener("click", showLogIn)
}

function showSignUp() {
	hide(".page")
	show("#signup_sec")
	docId("signup_form").addEventListener("submit", signUp)
	docId("signup_email").focus()
}

function showLogIn() {
	hide(".page")
	show("#login_sec")

	let email = bg.getEmail()
	if (!empty(email)) {
		let el = docId("login_email")
		el.value = email
		el.readOnly = true
		docId("login_pw").focus()
		docId("login_form").addEventListener("submit", logIn)
	} else {
		docId("login_email").focus()
		// browser checks the email field is valid before it submits the form.
		docId("login_form").addEventListener("submit", recoverLogIn)
	}
}

function showNewAccount() {
	hide("#shownewacct_sec")
	show("#newacctdetail_sec")
}

function hydrateSitePage(site) {
	let host = site[1]
	if (hydrateOldAccounts(host, docId("oldaccts"))) {
		show("#oldaccts_sec")
		show("#status_sec")
	}

	let lastPw = bg.getLastPw()
	if (lastPw) {
		docId("newacct_host").value = lastPw[0]
		docId("newacct_name").value = lastPw[1]
		docId("newacct_pw").value = lastPw[2]
		showNewAccount()
	} else {
		docId("newacct_host").value = host
	}
	
	docId("newacct_form").addEventListener("submit", saveNewAccount)
	docId("newacct_new").addEventListener("click", newAcctNew)
	docId("newacct_cancel").addEventListener("click", () => cancelNewAccount(host))
	docId("newacct_name").addEventListener("input", fillUsername)

	docId("editacct_form").addEventListener("submit", saveEditAccount)
	docId("editacct_new").addEventListener("click", newAcctEdit)
	docId("editacct_remove").addEventListener("click", removeEditAccount)
	docId("editacct_cancel").addEventListener("click", finishEditAccount)
}

function newAcctNew() {
	let pw = newPw("newacct_pw")
	bg.setLastPw(docId("newacct_host").value, docId("newacct_name").value, pw)
	currentTab()
		.then(tab => sendTabMessage(tab, {pw: pw, action: "new"}))
		.then(resp => {
			//console.log("new resp"); console.log(resp)
			if (resp && resp.name && resp.name.length > 0) {
				bg.setLastPw("", resp.name, "")
				docId("newacct_name").value = resp.name
			}
		})
}

function newPw(id) {
	let [pw, len, sc] = generatePw()
	docId(id).value = pw

	let s = `password size is ${len}`
	if (sc) {
		s += ", with special char"
	}
	showStatus(s)

	return pw
}

// <tr class="acct_row">
// <td class="copy_btn"><span id="name_{id}">{name}</span></td>
// <td class="copy_btn"><img id="pwimg_{id}" src="icons/pw.png" /></td>
// <td><img id="loginimg_{id}" src="icons/login.png" /></td>
// <td><input type="checkbox" id="autologin_{id}" checked></td>
// <td><img id="editimg_{id}" src="icons/edit.png" /></td>
// </tr>
function accountRow(acct, id, noSubmit, setHidden, updateRecent) {
	let [host, name, pw] = acct

	let tr = document.createElement("tr")
	tr.classList.add("acct_row")

	let nodes = new Array(4)
	nodes[0] = `<td class="copy_btn"><span id="name_${id}">${name}</span></td>`
	nodes[1] = `<td class="copy_btn"><img id="pwimg_${id}" src="icons/pw.png" /></td>`
	nodes[2] = `<td><img id="loginimg_${id}" src="icons/login.png" /></td>`
	nodes[3] = `<td><input type="checkbox" id="autologin_${id}"></td>`
	nodes[4] = `<td><img id="editimg_${id}" src="icons/edit.png" /></td>`
	tr.innerHTML = nodes.join("\n")

	let el = tr.querySelector(`#name_${id}`)
	el.addEventListener("mouseover", () => showStatus("click to copy name"))
	el.addEventListener("mouseout", () => showStatus(""))
	el.addEventListener("click", () => clip(name))

	el = tr.querySelector(`#pwimg_${id}`)
	el.addEventListener("mouseover", () => showStatus("click to copy password"))
	el.addEventListener("mouseout", () => showStatus(""))
	el.addEventListener("click", () => clip(pw))

	let autoel = tr.querySelector(`#autologin_${id}`)
	autoel.addEventListener("mouseover", () => showStatus("check to auto login"))
	autoel.addEventListener("mouseout", () => showStatus(""))
	autoel.checked = !noSubmit

	el = tr.querySelector(`#loginimg_${id}`)
	el.addEventListener("mouseover", () => showStatus("click to log in"))
	el.addEventListener("mouseout", () => showStatus(""))
	el.addEventListener("click", () => fillPassword(host, name, pw, autoel, setHidden, updateRecent))
	
	el = tr.querySelector(`#editimg_${id}`)
	el.addEventListener("mouseover", () => showStatus("click to edit account"))
	el.addEventListener("mouseout", () => showStatus(""))
	el.addEventListener("click", () => editAccount(host, name, pw))

	return tr
}

function hydrateOldAccounts(host, tb) {
	let accts = bg.matchSite(host)
	if (accts.length == 0) {
		return false
	}

	let noSubmit = autoSubmitBlacklist.has(host)
	let setHidden = hiddenWhitelist.has(host)

	for (let i = 0; i < accts.length; i++) {
		let tr = accountRow(accts[i], i, noSubmit, setHidden, accts.length > 2)
		tb.appendChild(tr)
	}
	return true
}

function showStatus(s) {
	docId("status_box").innerText = s
}

function editAccount(host, name, pw) {
	docId("editacct_host").value = host
	docId("editacct_old_host").value = host
	docId("editacct_name").value = name
	docId("editacct_old_name").value = name
	docId("editacct_pw").value = pw
	docId("editacct_old_pw").value = pw

	hide("#shownewacct_sec")
	show("#editacctdetail_sec")
}

function saveEditAccount(ev) {
	ev.preventDefault()
	let oldHost = docId("editacct_old_host").value
	let oldName = docId("editacct_old_name").value
	let oldPw = docId("editacct_old_pw").value
	let host = docId("editacct_host").value
	let name = docId("editacct_name").value
	let pw = docId("editacct_pw").value
	bg.updateAccount([
		["remove", oldHost, oldName, oldPw],
		["add", host, name, pw],
	]).then(finishEditAccount)
}

function newAcctEdit() {
	newPw("editacct_pw")
	let el = docId("editacct_pw")
	if (el.type === "password") {
		el.type = "text"
	}
}

function removeEditAccount() {
	let oldHost = docId("editacct_old_host").value
	let oldName = docId("editacct_old_name").value
	let oldPw = docId("editacct_old_pw").value
	bg.updateAccount([
		["remove", oldHost, oldName, oldPw],
	]).then(finishEditAccount)
}

function finishEditAccount() {
	docId("editacct_host").value = ""
	docId("editacct_old_host").value = ""
	docId("editacct_name").value = ""
	docId("editacct_old_name").value = ""
	docId("editacct_pw").value = ""
	docId("editacct_old_pw").value = ""
	window.close()
}

function fillPassword(host, name, pw, autoel, setHidden, updateRecent) {
	if (updateRecent) {
		bg.updateRecent(host, name)
	}

	currentTab()
		.then(tab => {
			let msg = {name: name, pw: pw}
			if (autoel.checked) {
				msg.action = "submit"
			}
			if (setHidden) {
				msg.hidden = true
			}
			return sendTabMessage(tab, msg)
		})
		.then(window.close)
}

function fillUsername() {
	let name = docId("newacct_name").value
	currentTab()
		.then(tab => sendTabMessage(tab, {action: "setname", name: name}))
}

function signUp(ev) {
	ev.preventDefault()
	let email = docId("signup_email").value
	let pw = docId("signup_pw").value
	if (empty(email) || empty(pw) || docId("signup_pw_m").value !== pw) {
		console.log("empty or mismatched pw")
		return
	}
	
	bg.signUp(email, pw)
		.then(() => loadPage())
}

function logIn(ev) {
	ev.preventDefault()
	let pw = docId("login_pw").value
	if (empty(pw)) {
		console.log("empty pw")
		return
	}

	bg.logIn(pw)
		.then(() => loadPage())
}

function recoverLogIn(ev) {
	ev.preventDefault()
	let email = docId("login_email").value
	let pw = docId("login_pw").value
	if (empty(email) || empty(pw)) {
		console.log("empty email or pw")
		return
	}

	bg.recoverLogIn(email, pw)
		.then(() => loadPage())
}

function saveNewAccount(ev) {
	ev.preventDefault()
	let host = docId("newacct_host").value
	let name = docId("newacct_name").value
	let pw = docId("newacct_pw").value
	bg.addAccount(host, name, pw)
		.then(window.close)
}

function cancelNewAccount(host) {
	bg.clearLastPw(docId("newacct_host").value)
	docId("newacct_host").value = host
	docId("newacct_name").value = ""
	docId("newacct_pw").value = ""

	hide("#newacctdetail_sec")
	show("#shownewacct_sec")
	showStatus("")
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

// inject page-fillpw.js
currentTab()
	.then(tab => chrome.tabs.executeScript(tab.id, {file: "page-fillpw.js", allFrames: true}))
