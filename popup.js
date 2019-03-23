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
		hide("#newacctdetail_sec")
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
	
	docId("newacct_form").addEventListener("submit", saveAccount)
	docId("newacct_new").addEventListener("click", newAcctNew)
	docId("newacct_reset").addEventListener("click", () => resetAccount(host))
	docId("newacct_name").addEventListener("input", fillUsername)
}

function newAcctNew() {
	let pw = generatePw()
	docId("newacct_pw").value = pw
	bg.setLastPw(docId("newacct_host").value, docId("newacct_name").value, pw)
	currentTab().then(tab => {
		chrome.tabs.sendMessage(tab.id, {pw: pw, action: "new"}, resp => {
			//console.log("new resp"); console.log(resp)
			if (resp && resp.name && resp.name.length > 0) {
				bg.setLastPw("", resp.name, "")
				docId("newacct_name").value = resp.name
			}
		})
	})
}

const acctTmpl = '<td>\n\
  <div class="tip">\n\
    <span id="name_{id}">{name}</span><span class="tiptext">copy</span>\n\
  </div>\n\
</td>\n\
<td class="center_td">\n\
  <input type="hidden" id="pw_{id}" value="{pw}">\n\
  <div class="tip">\n\
    <img id="pwimg_{id}" src="icons/pw.png" />&nbsp;\n\
    <span class="tiptext">copy</span>\n\
  </div>\n\
  <div class="tip">\n\
    <img id="fillimg_{id}" src="icons/ok.png" />\n\
    <span class="tiptext">fill</span>\n\
  </div>\n\
</td>'

function hydrateOldAccounts(host, tb) {
	let accts = bg.matchSite(host)
	if (accts.length == 0) {
		return false
	}
	accts.sort((a, b) => {
		// compare name
		if (a[1] < b[1]) {
			return -1
		} else if (a[1] === b[1]) {
			return 0
		}
		return 1
	})

	let noSubmit = autoSubmitBlacklist.has(host)
	let setHidden = hiddenWhitelist.has(host)

	for (let i = 0; i < accts.length; i++) {
		let x = accts[i]
		//console.log(x)
		let name = x[1]
		let pw = x[2]

		let acct = document.createElement("tr")
		acct.classList.add("acct_row")
		acct.innerHTML = acctTmpl.replace(/{id}/g, i+"")
			.replace(/{name}/g, name)
			.replace(/{pw}/g, pw)
		tb.appendChild(acct)
		let nameid = "name_"+i
		docId(nameid).addEventListener("click", () => copyName(nameid))
		let pwid = "pw_"+i
		docId("pwimg_"+i).addEventListener("click", () => copyPassword(pwid))
		docId("fillimg_"+i).addEventListener("click", ev => fillPassword(""+i, noSubmit || ev.ctrlKey, setHidden))
	}
	return true
}

function copyName(id) {
	let el = docId(id)
	clip(el.innerText)
}

function copyPassword(id) {
	let el = docId(id)
	clip(el.value)
}

function fillPassword(i, noSubmit, setHidden) {
	let name = docId("name_"+i).innerText
	let pw = docId("pw_"+i).value
	currentTab().then(tab => {
		let msg = {name: name, pw: pw}
		if (!noSubmit) {
			msg.action = "submit"
		}
		if (setHidden) {
			msg.hidden = true
		}
		chrome.tabs.sendMessage(tab.id, msg, () => window.close())
	})
}

function fillUsername() {
	let name = docId("newacct_name").value
	currentTab().then(tab => chrome.tabs.sendMessage(tab.id, {action: "setname", name: name}))
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

function saveAccount(ev) {
	ev.preventDefault()
	let host = docId("newacct_host").value
	let name = docId("newacct_name").value
	let pw = docId("newacct_pw").value
	bg.addAccount(host, name, pw)
		.then(() => window.close())
}

function resetAccount(host) {
	bg.clearLastPw(docId("newacct_host").value)
	docId("newacct_host").value = host
	docId("newacct_name").value = ""
	docId("newacct_pw").value = ""
}

// https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
function clip(t) {
	let ta = document.createElement("textarea")
	ta.textContent = t
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
