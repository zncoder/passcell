let bg = null

let hiddenWhitelist = new Set([
	"online.citi.com",
])

function loadPage() {
	//console.log("openpopup")
	hide(".page")

	// already opened
	if (bg.opened()) {
		showSites()
		return
	}

	// log in to existing account
	if (bg.isOldAccount()) {
		showLogIn()
		return
	}

	// choose signup or login
	show("#choose_sec")
	let el = docId("do_signup_btn")
	el.addEventListener("click", showSignUp)
	setTooltip(el, () => showStatus("sign up new account"))

	el = docId("do_login_btn")
	el.addEventListener("click", showLogIn)
	setTooltip(el, () => showStatus("log in to your account"))
}

async function showSites() {
	if (bg.isChrome) {
		docId("oldaccts_sec").classList.add("oldaccts_chrome")
	}

	hide(".page")
	hide("#oldaccts_sec")
	hide("#newacctdetail_sec")
	hide("#editacctdetail_sec")
	show("#site_sec")
	show("#shownewacct_sec")
	docId("shownewacct_acct").addEventListener("click", showNewAccount)

	let tab = await currentTab()
	hydrateSitePage(tidyUrl(tab.url))
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
	if (email) {
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

	let autologin = docId("autologin")
	setAutoLoginState(autologin, bg.hostAutoLogin(host))
	autologin.addEventListener("click", () => setAutoLoginState(autologin, !autoLoginEnabled()))
	setTooltip(autologin, () => showAutoLoginStatus(autologin))

	if (hydrateOldAccounts(host, docId("oldaccts"))) {
		show("#oldaccts_sec")
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

	showStatus("")
}

function setAutoLoginState(autologin, enable) {
	if (enable) {
		autologin.setAttribute("mystate", "1")
		autologin.src = "icons/toggleon.svg"
	} else {
		autologin.setAttribute("mystate", "0")
		autologin.src = "icons/toggleoff.svg"
	}
	showAutoLoginStatus()
}

function showAutoLoginStatus() {
	showStatus(autoLoginEnabled() ? "click to disable auto login" : "click to enable auto login")
}

async function newAcctNew() {
	let pw = newPw("newacct_pw")
	bg.setLastPw(docId("newacct_host").value, docId("newacct_name").value, pw)
	let tab = await currentTab()
	let resp = await sendTabMessage(tab, {pw: pw, action: "new"})
	//console.log("new resp"); console.log(resp)
	let name = docId("newacct_name")
	// set name from page if not set
	if (resp && resp.name && resp.name.length > 0 && !name.value) {
		bg.setLastPw("", resp.name, "")
		name.value = resp.name
	}
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
// <td class="copy_btn"><img id="pwimg_{id}" src="icons/pw.svg" /></td>
// <td><img id="editimg_{id}" src="icons/edit.svg" /></td>
// <td><img id="loginimg_{id}" src="icons/login.svg" /></td>
// </tr>
function accountRow(acct, id, setHidden, updateRecent) {
	let [host, name, pw] = acct

	let tr = document.createElement("tr")
	tr.classList.add("acct_row")

	let nodes = new Array(5)
	nodes[0] = `<td class="acct_btn"><span class="copy_btn" id="name_${id}">${name}</span></td>`
	nodes[1] = `<td class="acct_btn"><img class="copy_btn" id="pwimg_${id}" src="icons/pw.svg" width="18" /></td>`
	nodes[2] = `<td class="acct_btn"><img id="editimg_${id}" src="icons/edit.svg" width="18" /></td>`
	nodes[3] = `<td class="acct_btn"><img id="loginimg_${id}" src="icons/login.svg" width="18" /></td>`
	tr.innerHTML = nodes.join("\n")

	let el = tr.querySelector(`#name_${id}`)
	setTooltip(el, () => showStatus("click to copy name"))
	el.addEventListener("click", () => {
		clip(name)
		showStatus("name is copied to clipboard")
	})

	el = tr.querySelector(`#pwimg_${id}`)
	setTooltip(el, () => showStatus("click to copy password"))
	el.addEventListener("click", () => {
		clip(pw)
		showStatus("password is copied to clipboard for 30s")
		bg.clearClipPassword(30*1000)
	})

	el = tr.querySelector(`#loginimg_${id}`)
	setTooltip(el, () => showStatus(autoLoginEnabled() ? "click to log in" : "click to fill out form"))
	el.addEventListener("click", () => fillPassword(host, name, pw, setHidden, updateRecent))
	
	el = tr.querySelector(`#editimg_${id}`)
	setTooltip(el, () => showStatus("click to edit account"))
	el.addEventListener("click", () => editAccount(host, name, pw))

	return tr
}

function setTooltip(el, cb) {
	el.addEventListener("mouseover", cb)
	el.addEventListener("mouseout", () => showStatus(""))
}

function hydrateOldAccounts(host, tb) {
	let accts = bg.matchSite(host)
	if (accts.length == 0) {
		return false
	}

	let setHidden = hiddenWhitelist.has(host)

	for (let i = 0; i < accts.length; i++) {
		let tr = accountRow(accts[i], i, setHidden, accts.length > 2)
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

async function saveEditAccount(ev) {
	ev.preventDefault()
	let oldHost = docId("editacct_old_host").value
	let oldName = docId("editacct_old_name").value
	let oldPw = docId("editacct_old_pw").value
	let host = docId("editacct_host").value
	let name = docId("editacct_name").value
	let pw = docId("editacct_pw").value
	await bg.updateAccount([
		["remove", oldHost, oldName, oldPw],
		["add", host, name, pw],
	])
	finishEditAccount()
}

function newAcctEdit() {
	newPw("editacct_pw")
	let el = docId("editacct_pw")
	if (el.type === "password") {
		el.type = "text"
	}
}

async function removeEditAccount() {
	let oldHost = docId("editacct_old_host").value
	let oldName = docId("editacct_old_name").value
	let oldPw = docId("editacct_old_pw").value
	await bg.updateAccount([
		["remove", oldHost, oldName, oldPw],
	])
	finishEditAccount()
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

function autoLoginEnabled() {
	return docId("autologin").getAttribute("mystate") === "1"
}

async function fillPassword(host, name, pw, setHidden, updateRecent) {
	let autologin = autoLoginEnabled()
	bg.accountSelected(host, name, updateRecent, autologin)

	let tab = await currentTab()
	let msg = {name: name, pw: pw}
	if (autologin) {
		msg.action = "submit"
	}
	if (setHidden) {
		msg.hidden = true
	}
	await sendTabMessage(tab, msg)
	window.close()
}

async function fillUsername() {
	let name = docId("newacct_name").value
	let tab = await currentTab()
	return sendTabMessage(tab, {action: "setname", name: name})
}

async function signUp(ev) {
	ev.preventDefault()
	let email = docId("signup_email").value
	let el = docId("signup_pw")
	let pw = el.value
	if (!email || !pw || docId("signup_pw_m").value !== pw) {
		console.log("empty or mismatched pw")
		return
	}
	
	try {
		await bg.signUp(email, pw)
		loadPage()
	} catch (e) {
		console.log("signup err"); console.log(e);
		el.select();
		showStatus("signup error")
	}
}

async function logIn(ev) {
	ev.preventDefault()
	let el = docId("login_pw")
	let pw = el.value
	if (!pw) {
		console.log("empty pw")
		return
	}

	try {
		await bg.logIn(pw)
		loadPage()
	} catch (e) {
		console.log("login err"); console.log(e)
		el.select()
		showStatus("login error")
	}			 
}

async function recoverLogIn(ev) {
	ev.preventDefault()
	let email = docId("login_email").value
	let el = docId("login_pw")
	let pw = el.value
	if (!email || !pw) {
		console.log("empty email or pw")
		return
	}

	try {
		await bg.recoverLogIn(email, pw)
		loadPage()
	} catch (e) {
		console.log("recoverlogin err"); console.log(e)
		el.select()
		showStatus("recover login error")
	}
}

async function saveNewAccount(ev) {
	ev.preventDefault()
	let host = docId("newacct_host").value
	let name = docId("newacct_name").value
	let pw = docId("newacct_pw").value
	await bg.addAccount(host, name, pw)
	window.close()
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

async function init() {
	bg = await getBackgroundPage()
	try {
		loadPage()

		// inject page-fillpw.js
		let tab = await currentTab()
		chrome.tabs.executeScript(tab.id, {file: "page-fillpw.js", allFrames: true}, result => {
			if (chrome.runtime.lastError) {
				console.log("inject page-fillpw err:" + chrome.runtime.lastError.message)
				return
			}
		})
	} catch (e) {
		console.log("popup err"); console.log(e) // preserve struct
	}
}

init()
