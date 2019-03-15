// TODO: 
// - notes
// - sort accounts by most recent use time
// - few password combinations

// notes:
//
// pw # memorized
// mastersalt # stored in server
// sealkey = PBKDF2(pw, mastersalt) # kept in memory in client
// authsalt = PBKDF2(email+'authsalt', mastersalt)
// authcred = PBKDF2(sealkey, authsalt) # stored in server
//
// signup
// - generate mastersalt
// - upload authkey
//
// login with existing mastersalt
// - send authkey
//
// login from scratch
// - prelogin to get mastersalt
// - send authkey
//
// no permission of backend is needed for cors requests?
// errors in the page that are triggered by sendMessage are populated back to caller
// content_scripts is injected to every iframe and runs independently, when all_frames is true

const localBackend = "http://localhost:10008"
const prodBackend = "https://54.67.41.163.sslip.io:10008"
const postTimeout = 10000 // 10s

let state = {
	// masterKey is initialized from pw during signup or login.
	// it is never saved.
	masterKey: null,
	// token is from server after successful signup or login
	token: "",
	stopWatch: false,
	backend: prodBackend,
	// tokener refreshes access token
	tokener: null,
	// last pw that is not saved, [host, name, pw]
	lastPw: undefined,

	email: "",
	// masterSalt and sealed sites are saved on server
	masterSalt: null,
	// version is the latest version we get from server
	version: 0,
	// array of [host, username, pw]
	sites: []
}

function opened() {
	return state.masterKey !== null
}

function isOldAccount() {
	return state.masterSalt !== null
}

function getLastPw() {
	return state.lastPw
}

function setLastPw(host, name, pw) {
	if (state.lastPw) {
		if (host !== "") {
			state.lastPw[0] = host
		}
		if (name !== "") {
			state.lastPw[1] = name
		}
		if (pw !== "") {
			state.lastPw[2] = pw
		}
	} else {
		state.lastPw = [host, name, pw]
	}
	chrome.browserAction.setBadgeText({text: "✚"})
}

function clearLastPw(host) {
	if (state.lastPw && state.lastPw[0] === host) {
		state.lastPw = undefined
		chrome.browserAction.setBadgeText({text: ""})
	}
}

function getSites() {
	state.sites.sort((a, b) => {
		if (a[0] < b[0]) {
			return -1
		} else if (a[0] === b[0]) {
			return 0
		}
		return 1
	})
	return state.sites
}

function getEmail() {
	return state.email
}

// https://github.com/diafygi/webcrypto-examples

function loadPlaintextState() {
	return localGet(["email", "mastersalt", "version"])
		.then(x => {
			//console.log("loadmastersalt"); console.log(x)
			if (x.mastersalt) {
				state.masterSalt = hex2bytes(x.mastersalt)
				state.email = x.email
				state.version = x.version
			}
		})
		.catch(e => { console.log("loadplaintextstate err"); console.log(e); })
}

loadPlaintextState()						// no need to wait for it to finish?

function signUp(em, pw) {
	// sign up,
	// upload state to server
	let salt = nonce(24)
	let k, tk
	return deriveSealKey(pw, salt)
		.then(x => {
			k = x
			return signUpRemote(state.backend, pw, em, salt)
		})
		.then(x => {
			tk = x
			return newTokener(state.backend, em, pw, salt)
		})
		.then(tr => {
			state.masterKey = k
			state.token = tk
			state.email = em
			state.masterSalt = salt
			state.tokener = tr

			enableContextMenu()
			return pushState()
		})
		.then(ver => {
			onSignedIn()
			return ver
		})
 		.catch(e => { console.log("signup err"); console.log(e); }) // terminate promise chain
}

function onSignedIn() {
	// no return to unchain this promise.
	// watchRemote runs in its own promise chain forever.
	watchRemote()
}

function signUpRemote(url, pw, em, salt) {
	return deriveAuthCred(pw, em, salt)
		.then(cred => {
			let v = {
				email: em,
				mastersalt: bytes2hex(salt),
				cred: cred
			}
			return post(url+"/signup", v, postTimeout)
		})
		.then(res => {
			// console.log("signup res:"); console.log(res)
			return res.token
		})
}

function logIn(pw) {
	return deriveSealKey(pw, state.masterSalt)
		.then(k => loadSealedState(k))
		.then(() => newTokener(state.backend, state.email, pw, state.masterSalt))
		.then(tr => {
			state.tokener = tr
			return refreshToken()
		})
		.then(() => {			
			enableContextMenu()
			onSignedIn()
		})
		.catch(e => { console.log("login err"); console.log(e); }) // terminate promise chain
}

function newTokener(url, em, pw, salt) {
	return deriveAuthCred(pw, em, salt)
		.then(cred => {
			//console.log("cred"); console.log(cred)
			let arg = {
				email: em,
				cred: cred
			}
			return () => {
				return post(url+"/login", arg, postTimeout)
					.then(res => {
						console.log("got token"); console.log(res.token)
						return res.token
					})
			}
		})
}

function refreshToken() {
	console.log("refreshtoken")
	return state.tokener()
		.then(tk => state.token = tk)
}

function recoverLogIn(em, pw) {
	let salt, k, tr
	return preLogInRemote(state.backend, em)
		.then(x => {
			salt = x
			return deriveSealKey(pw, salt)
		})
		.then(x => {
			k = x
			return newTokener(state.backend, em, pw, salt)
		})
		.then(x => {
			tr = x
			return tr()
		})
		.then(tk => {
			state.masterKey = k
			state.token = tk
			state.masterSalt = salt
			state.email = em
			state.tokener = tr

			enableContextMenu()
			onSignedIn()
		})
		.catch(e => { console.log("recoverlogin err"); console.log(e); })
}

function preLogInRemote(url, em) {
	let arg = {email: em}
	return post(url+"/prelogin", arg, postTimeout)
		.then(res => {
			return hex2bytes(res.mastersalt)
		})
}

function watchRemote() {
	if (state.stopWatch) {
		console.log("stop remote watcher")
		return
	}

	return pullRemote(true)
		.then(() => watchRemote())
}

function loadSealedState(key) {
	return localGet("sites")
		.then(x => unsealSites(key, x.sites))
		.then(ss => {
			//console.log("state unsealed")
			state.masterKey = key
			state.sites = ss
		})
}

function unsealSites(key, s) {
	let x = JSON.parse(s)
	//console.log("x"); console.log(x)
	return unseal(key, x)
		.then(b => JSON.parse(b2s(b)))
}

function sealSites(key, ss) {
	let s = JSON.stringify(ss)
	return seal(key, s2b(s))
		.then(x => JSON.stringify(x))
}

// save state locally and push to remote
function pushState() {
	let ct
	return sealSites(state.masterKey, state.sites)
		.then(x => {
			ct = x
			return saveState(ct)
		})
		.then(() => pushRemote(state.backend, state.token, state.version, ct, 0))
}

// save state locally
function saveState(ct) {
	let v = {
		email: state.email,
		mastersalt: bytes2hex(state.masterSalt),
		version: state.version,
		sites: ct
	}
	return localSet(v)
}

// pullRemote:
//    - watches for change
//    - fetches the latest version from server
//    - overwrites local sites.
// pushRemote:
//    - seal sites
//    - push the change
//    - no retry on conflict push, as pullRemote would overwrite local sites.

function pullRemote(wait) {
	return fetchRemote(state.backend, state.masterKey, state.token, state.version, wait, 0)
		.then(vctss => {
			let [ver, ct, ss] = vctss
			console.log("pullremote got version:"+ver)
			if (ver <= state.version) {
				return
			}
			
			state.version = ver
			state.sites = ss
			return saveState(ct)
		})
}

function fetchRemote(url, k, tk, ver, wait, delay) {
	let arg = {
		token: tk,
		cur_version: ver,
		wait: wait,
	}

	let to = wait ? 90*1000 : 10*1000

	return post(url+"/get", arg, to)
		.then(res => {
			//console.log("fetchremote res"); console.log(res)
			let x = JSON.parse(res.value)
			return unsealSites(k, x.sites).then(ss => [res.version, x.sites, ss])
		})
		.catch(e => {
			console.log("fetchremote err"); console.log(e)
			return backoffRefresh(delay, tk, e)
				.then(mt => {
					[delay, tk ] = mt
					return fetchRemote(url, k, tk, ver, wait, delay)
				})
		})
}

function backoffRefresh(delay, tk, e) {
	return backoff(delay)
		.then(x => {
			delay = x

			if (e.message !== "Unauthorized") {
				return tk
			} else {
				return refreshToken()
			}
		})
		.then(x => [delay, x])
}

function pushRemote(url, tk, ver, ct, delay) {
	let s = JSON.stringify({sites: ct}) // save as object for future changes.
	let arg = {
		token: tk,
		prev_version: ver,
		value: s
	}
	//console.log("put arg:"); console.log(arg)

	return post(url+"/put", arg, postTimeout)
		.then(res => {
			console.log("uploaded version:"+res.version)
			return res.version
		})
		.catch(e => {
			//console.log("pushremote err"); console.log(e)
			if (e.message === "Conflict") {
				console.log("conflict version")
				return
			}
			return backoffRefresh(delay, tk, e)
				.then(mt => {
					[delay, tk] = mt
					return pushRemote(url, tk, ver, ct, delay)
				})
		})
}

function addAccount(host, name, pw) {
	for (let i = 0; i < state.sites.length; i++) {
		let x = state.sites[i]
		if (x[0] == host && x[1] == name && x[2] == pw) {
			return
		}
	}
	state.sites.push([host, name, pw])
}

function matchSite(host) {
	let accts = []
	let dom = hostDomain(host)
	let sfx = "." + dom
	for (let i = 0; i < state.sites.length; i++) {
		let x = state.sites[i]
		if (x[0] == dom || x[0].endsWith(sfx)) {
			accts.push(x)
		}
	}
	return accts
}

// *.a.b => a.b, a.b => a.b, a => a
function hostDomain(host) {
	let i = host.lastIndexOf(".")
	if (i <= 0) {
		return host
	}
	i--
	i = host.lastIndexOf(".", i)
	if (i <= 0) {
		return host
	}
	return host.substring(i+1)
}

function resetSites(sts) {
	console.log("resetsites"); console.log(sts)
	// make a copy of sites to avoid dead object
	ss = []
	for (let i = 0; i < sts.length; i++) {
		let [h, n, p] = sts[i]
		ss.push([h, n, p])
	}
	state.sites = ss
	return pushState()
		.catch(e => { console.log("resetsites err"); console.log(e); })
}

function startImportSites() {
	chrome.tabs.executeScript({file: "page-importpw.js"})
}

function importSites(ss) {
	//console.log("importsites"); console.log(ss)
	for (let x of ss) {
		let [h, n, p] = x
		addAccount(h, n, p)
	}
	return pushState()
}

function handleImportSites(ss, sendResponse) {
	return importSites(ss)
		.then(() => sendResponse({response: "sites imported"}))
		.catch(e => { console.log("handleimportsites err"); console.log(e); })
}

function handleNewSite(req, sendResponse) {
	setLastPw(req.host, req.name, req.pw)
}

function handleMessage(req, sender, sendResponse) {
	//console.log("got req"); console.log(req)
	switch (req.action) {
	case "import":
		handleImportSites(req.sites, sendResponse)
		break

	case "new":
		handleNewSite(req, sendResponse)
		break

	default:
		console.log("unknown req"); console.log(req)
		break
	}
}

function enableContextMenu() {
	chrome.runtime.onMessage.addListener(handleMessage)

	chrome.contextMenus.create({
		id: "import-sites",
		title: "Import Sites",
		contexts: ["browser_action"]
	})
	chrome.contextMenus.create({
		id: "import-lastpass-csv",
		title: "Import LastPass Exported CSV",
		contexts: ["browser_action"]
	})
	chrome.contextMenus.create({
		id: "edit-sites",
		title: "Edit Sites",
		contexts: ["browser_action"]
	})
	chrome.contextMenus.create({
		id: "export-sites",
		title: "Export Sites",
		contexts: ["browser_action"]
	})
	chrome.contextMenus.onClicked.addListener((info, tab) => {
		switch (info.menuItemId) {
		case "import-sites":
			startImportSites()
			break
		case "import-lastpass-csv":
			chrome.tabs.create({"url": "/page-importlastpasscsv.html"})
			break
		case "edit-sites":
			chrome.tabs.create({"url": "/page-editsite.html"})
			break
		case "export-sites":
			chrome.tabs.create({"url": "/page-exportsite.html"})
			break
		}
	})
}
