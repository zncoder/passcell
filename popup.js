let bg = null;

let pwLen = 32; // 8,16,24,32
let pwMode = 0;

let autofillBlacklist = new Set([]);

getBackgroundPage()
	.then(x => {
		bg = x;
		// wait for background tasks to finish
		bg.ready().then(() => openPopup());
	})
	.catch(e => { console.log("popup err"); console.log(e); });

function openPopup() {
	//console.log("openpopup");
	hidePages();

	// already logged in
	if (bg.loggedIn()) {
		show("site_sec");
		hide("oldaccts_sec");
		show("shownewacct_sec");
		hide("newacctdetail_sec");
		docId("shownewacct_acct").addEventListener("click", showNewAccount);
		chrome.tabs.query({active: true, currentWindow: true}, ts => {
			hydrateSitePage(tidyUrl(ts[0].url));
		});
		return;
	}

	// log in to existing account
	if (bg.isOldAccount()) {
		showLogIn();
		return;
	}

	// choose signup or login
	show("choose_sec");
	docId("do_signup_btn").addEventListener("click", showSignUp);
	docId("do_login_btn").addEventListener("click", showLogIn);
}

function showSignUp() {
	hidePages();
	show("signup_sec");
	docId("signup_form").addEventListener("submit", signUp);
	docId("signup_email").focus();
}

function showLogIn() {
	hidePages();
	show("login_sec");

	let email = bg.getEmail();
	if (!empty(email)) {
		let el = docId("login_email");
		el.value = email;
		el.readOnly = true;
		docId("login_pw").focus();
		docId("login_form").addEventListener("submit", logIn);
	} else {
		docId("login_email").focus();
		// browser checks the email field is valid before it submits the form.
		docId("login_form").addEventListener("submit", recoverLogIn);
	}
}

function showNewAccount() {
	hide("shownewacct_sec");
	show("newacctdetail_sec");
}

function hidePages() {
	for (let x of document.getElementsByClassName("page")) {
		x.style.display = "none";
	}
}

function hydrateSitePage(site) {
	let host = site[1];
	if (hydrateOldAccounts(host, docId("oldaccts"))) {
		show("oldaccts_sec");
	}

	let lastPw = bg.getLastPw(host);
	if (lastPw) {
		docId("newacct_name").value = lastPw[1];
		docId("newacct_pw").value = lastPw[2];
		showNewAccount();
	}
	docId("newacct_form").addEventListener("submit", () => saveAccount(host));
	docId("newacct_new").addEventListener("click", () => newAcctNew(host));
	docId("newacct_resize").addEventListener("click", () => newAcctResize(host));
}

function newAcctPw(host) {
	let pw = generatePw(pwMode, pwLen);
	docId("newacct_pw").value = pw;
	//clip(pw);
	chrome.tabs.query({active: true, currentWindow: true}, ts => {
		chrome.tabs.sendMessage(ts[0].id, {pw: pw, action: "new"}, resp => {
			//console.log("new resp"); console.log(resp);
			bg.setLastPw(host, resp.name, pw);
			if (resp.name) {
				docId("newacct_name").value = resp.name;
			}
		});
	});
}

function newAcctNew(host) {
	pwMode = rotatePwMode(pwMode);
	newAcctPw(host);
}

function newAcctResize(host) {
	pwLen = rotatePwLen(pwLen);
	newAcctPw(host);
}

const acctTmpl = '<td>\n\
  <div class="tip">\n\
    <span id="name_{id}">{name}</span><span class="tiptext">copy</span>\n\
  </div>\n\
</td>\n\
<td class="center_td">\n\
  <input type="hidden" id="pw_{id}" value="{pw}">\n\
  <div class="tip">\n\
    <img id="pwimg_{id}" src="icons/copy.png" />&nbsp;\n\
    <span class="tiptext">copy</span>\n\
  </div>\n\
  <div class="tip">\n\
    <img id="fillimg_{id}" src="icons/fill.png" />\n\
    <span class="tiptext">fill</span>\n\
  </div>\n\
</td>';

function hydrateOldAccounts(host, tb) {
	let accts = bg.matchSite(host);
	if (accts.length == 0) {
		return false;
	}
	accts.sort((a, b) => {
		// compare name
		if (a[1] < b[1]) {
			return -1;
		} else if (a[1] === b[1]) {
			return 0;
		}
		return 1;
	});

	let nofill = autofillBlacklist.has(host);

	for (let i = 0; i < accts.length; i++) {
		let x = accts[i];
		//console.log(x);
		let name = x[1];
		let pw = x[2];

		let acct = document.createElement("tr");
		acct.classList.add("acct_row");
		acct.innerHTML = acctTmpl.replace(/{id}/g, i+"")
			.replace(/{name}/g, name)
			.replace(/{pw}/g, pw);
		tb.appendChild(acct);
		let nameid = "name_"+i;
		docId(nameid).addEventListener("click", () => copyName(nameid));
		let pwid = "pw_"+i;
		docId("pwimg_"+i).addEventListener("click", () => copyPassword(pwid));
		docId("fillimg_"+i).addEventListener("click", ev => fillPassword(""+i, nofill || ev.ctrlKey));
	}
	return true;
}

function copyName(id) {
	let el = docId(id);
	clip(el.innerText);
}

function copyPassword(id) {
	let el = docId(id);
	clip(el.value);
}

function fillPassword(i, nofill) {
	let name = docId("name_"+i).innerText;
	let pw = docId("pw_"+i).value;
	chrome.tabs.query({active: true, currentWindow: true}, ts => {
		let msg = {name: name, pw: pw};
		if (!nofill) {
			msg.action = "fill";
		}
		chrome.tabs.sendMessage(ts[0].id, msg, () => window.close());
	});
}

function signUp() {
	let email = docId("signup_email").value;
	let pw = docId("signup_pw").value;
	if (empty(email) || empty(pw) || docId("signup_pw_m").value !== pw) {
		console.log("empty or mismatched pw");
		return;
	}
	
	let p = bg.signUp(email, pw)
			.catch(e => {console.log("signup err"); console.log(e);});
	// save this promise in background. we need to wait for it to finish
	// before we can open popup.
	bg.savePromise(p);
}

function logIn() {
	let pw = docId("login_pw").value;
	if (empty(pw)) {
		console.log("empty pw");
		return;
	}

	let p = bg.logIn(pw)
			.catch(e => {console.log("login err"); console.log(e);});
	bg.savePromise(p);
}

function recoverLogIn() {
	let email = docId("login_email").value;
	let pw = docId("login_pw").value;
	if (empty(email) || empty(pw)) {
		console.log("empty email or pw");
		return;
	}

	let p = bg.recoverLogIn(email, pw)
			.catch(e => {console.log("recoverlogin err"); console.log(e);});
	bg.savePromise(p);
}

function saveAccount(host) {
	let name = docId("newacct_name").value;
	let pw = docId("newacct_pw").value;
	bg.addAccount(host, name, pw);
	bg.clearLastPw(host);
	bg.pushState().then(() => {
		window.close();
	});
}

// https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
function clip(t) {
	let ta = document.createElement("textarea");
	ta.textContent = t;
	ta.style.position = "fixed";
	document.body.appendChild(ta);
	ta.select();
	try {
		document.execCommand("copy");
	} catch (e) {
		console.log("copy to clipboard err"); console.log(e);
	} finally {
		document.body.removeChild(ta);
	}
}
