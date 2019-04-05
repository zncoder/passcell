// TODO: 
// - notes
// - keep log of all changes in server
// - search a site
// - get form confirmed from executeScript

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
// changes from multiple devices are serialized by server.
// - version increments on every push
// - a push is accepted only if version matches
//    (no changes between this push and the last pull)
// - a push is rejected if version does not match, and
//    this device will pull the latest version, apply
//    the changes, and push again.
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
	sites: [],
	// recent 2 accounts per domain. domain => [1st, 2nd]
	recents: {},
	// noautologin choice per domain.
	noautologins: new Set(),
	// diffs since the last push.
	// applying the same set of diffs should be idempotent.
	// a diff is ["add", host, name, pw], ["remove", host, name, pw]
	diffset: [],
	// diffs are indexed so that we can tie a push with the particular
	// set of diffs.  it is possible to have multiple pushes in
	// flight. when a push completes, we truncate the diffset to the
	// index and increment the base. base does not need to be persisted.
	base: 0,
}

// debug stuff
let stopWatch = false
let retryOnErr = true

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
	return localGet(["email", "mastersalt", "version", "recents", "noautologins"])
		.then(x => {
			//console.log("loadmastersalt"); console.log(x)
			if (x.mastersalt) {
				state.masterSalt = hex2bytes(x.mastersalt)
				state.email = x.email
				state.version = x.version
				state.recents = x.recents || {}
				state.noautologins = new Set(x.noautologins || [])
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
			
			if (state.diffset.length > 0) {
				return applyDiffs()
			}
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
						console.log(`got token ${res.token}`)
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
	if (stopWatch) {
		console.log("stop remote watcher")
		return
	}

	return pullRemote(true)
		.then(() => {
			// apply diffs that are not committed.
			if (state.diffset.length > 0) {
				console.log(`apply ${state.diffset.length} diffs`)
				// catch errors to make sure watchRemote is chained
				return applyDiffs()
					.catch(e => {console.log("applydiffs after pull err:"); console.log(e)})
			}
		})
		.then(() => {
			return watchRemote()
		})
}

function loadSealedState(key) {
	return localGet(["sites", "diffset"])
		.then(x => Promise.all([unsealObject(key, x.sites), unsealObject(key, x.diffset)]))
		.then(x => {
			//console.log("state unsealed")
			let [ss, ds] = x
			state.masterKey = key
			state.sites = ss || []
			state.diffset = ds || []
		})
}

function unsealObject(key, s) {
	if (!s) {
		return Promise.resolve(undefined)
	}
	let x = JSON.parse(s)
	//console.log("x"); console.log(x)
	return unseal(key, x)
		.then(b => JSON.parse(b2s(b)))
}

function sealObject(key, ss) {
	let s = JSON.stringify(ss)
	return seal(key, s2b(s))
		.then(x => JSON.stringify(x))
}

function applyDiffs() {
	for (let x of state.diffset) {
		switch (x[0]) {
		case "add":
			addSiteEntry(x[1], x[2], x[3])
			break

		case "remove":
			removeSiteEntry(x[1], x[2])
			break
		}
	}

	return pushState()
}

// save state locally and push to remote
function pushState() {
	let ct
	let ctds
	// tie diffset with this push. retry would use the same end
	let end = state.base + state.diffset.length
	//console.log(`pushstate base:${state.base},end:${end}`)
	return Promise.all([state.sites, state.diffset]
										 .map(x => sealObject(state.masterKey, x)))
		.then(x => {
			[ct, ctds] = x
			return saveState(ct, ctds)
		})
		.then(() => pushRemote(state.backend, state.token, state.version, ct, end, 0))
}

// save state locally
function saveState(ct, ctds) {
	let v = {
		email: state.email,
		mastersalt: bytes2hex(state.masterSalt),
		version: state.version,
		sites: ct,
		diffset: ctds,
	}
	return localSet(v)
}

function saveDiffset() {
	return sealObject(state.masterKey, state.diffset)
		.then(ctds => localSet({diffset: ctds}))
}

// pullRemote:
//    - watches for change
//    - fetches the latest version from server
//    - overwrites local sites
//    - if diffset is not empty, applies diffset and push state
// pushRemote:
//    - seal sites
//    - push the change
//    - truncate diffset that is pushed. diffset after the push will be pushed by next pullRemote
//        - diffset is an array of changes
//        - base of diffset increases monotonically
//        - each push is sites + offset to diffset (index = offset - base)
//    - no retry on conflict push, as pullRemote would overwrite local sites.

function pullRemote(wait) {
	return fetchRemote(state.backend, state.masterKey, state.token, state.version, wait, 0)
		.then(vctss => {
			let [ver, ct, ss] = vctss
			//console.log(`pullremote got version:${ver}`)
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

	//console.log(`fetchremote with timeout:${to}`)
	return post(url+"/get", arg, to)
		.then(res => {
			console.log(`fetchremote version:${res.version}`)
			let x = JSON.parse(res.value)
			return unsealObject(k, x.sites).then(ss => [res.version, x.sites, ss])
		})
		.catch(e => {
			if (!retryOnErr) {
				console.log("fetchremote err"); console.log(e)
				return Promise.reject(e)
			}
			return backoffRefresh(delay, tk, e)			
				.then(x => {
					[delay, tk] = x
					return fetchRemote(url, k, tk, ver, wait, delay)
				})
		})
}

function backoffRefresh(delay, tk, e) {
	if (e.name === "AbortError") {
		// fetch aborted, no backoff and reset delay
		return Promise.resolve([0, tk])
	}

	return backoff(delay)
		.then(x => {
			delay = x

			if (e.message === "Unauthorized") {
				return refreshToken()
			}
			return tk
		})
		.then(tk => [delay, tk])
}

function pushRemote(url, tk, ver, ct, end, delay) {
	let s = JSON.stringify({sites: ct}) // save as object for future changes.
	let arg = {
		token: tk,
		prev_version: ver,
		value: s
	}

	return post(url+"/put", arg, postTimeout)
		.then(res => {
			if (end > state.base) {
				console.log(`pushed version:${res.version}, truncate diffset from ${state.base} to ${end}`)
				state.diffset.splice(0, end - state.base)
				state.base = end
				return saveDiffset()
			} else {
				console.log(`diffset:${end} of version:${res.version} is superseded`)
			}
		})
		.catch(e => {
			console.log(`pushremote at version:${ver},end:${end} err`); console.log(e)
			if (e.message === "Conflict") {
				// no retry on conflict version.
				// let pullremote retry push after get the latest version.
				console.log("conflict version")
				return Promise.reject(e)
			}
			if (!retryOnErr) {
				console.log("pushremote err"); console.log(e)
				return Promise.reject(e)
			}
			return backoffRefresh(delay, tk, e)
				.then(x => {
					[delay, tk] = x
					return pushRemote(url, tk, ver, ct, end, delay)
				})
		})
}

function addSiteEntry(host, name, pw) {
	for (let x of state.sites) {
		if (x[0] === host && x[1] === name) {
			console.log(`change pw of ${host}:${name}`)
			x[2] = pw
			return
		}
	}
	console.log(`new entry ${host}:${name}`)
	state.sites.push([host, name, pw])
}

function removeSiteEntry(host, name) {
	for (let i = 0; i < state.sites.length; i++) {
		let x = state.sites[i]
		if (x[0] === host && x[1] === name) {
			console.log(`remove entry ${host}:${name}`)
			state.sites.splice(i, 1)
			return
		}
	}
}

function addAccount(host, name, pw) {
	addSite(host, name, pw)
	clearLastPw(host)
	return pushState()
		.catch(e => {console.log("pushstate err"); console.log(e)})
}

function addSite(host, name, pw) {
	addSiteEntry(host, name, pw)
	// todo: seal and save diffset
	state.diffset.push(["add", host, name, pw])
}

function removeSite(host, name) {
	removeSiteEntry(host, name)
	state.diffset.push(["remove", host, name])
}

function updateAccount(diffs) {
	for (let x of diffs) {
		switch (x[0]) {
		case "add":
			addSite(x[1], x[2], x[3])
			break

		case "remove":
			removeSite(x[1], x[2])
			break
		}
	}

	return pushState()
		.catch(e => {console.log("pushstate err"); console.log(e)})
}

function accountSelected(host, name, updateRecent, autologin) {
	let change = {}
	let dom = hostDomain(host)
	if (autologin === state.noautologins.has(dom)) {
		if (autologin) {
			state.noautologins.delete(dom)
		} else {
			state.noautologins.add(dom)
		}
		change.noautologins = Array.from(state.noautologins)
	}

	if (updateRecent) {
		let x = state.recents[dom]
		if (!x || x[0] !== name) {
			if (!x) {
				state.recents[dom] = [name]
			} else {
				if (x.length === 1) {
					x.push("") // resize
				}
				x[1] = x[0]
				x[0] = name
			}
			change.recents = state.recents
		}
	}

	if (Object.getOwnPropertyNames(change).length == 0) {
		return Promise.resolve(true)
	}
	return localSet(change)
}

function hostAutoLogin(host) {
	let dom = hostDomain(host)
	return !state.noautologins.has(dom)
}

function recentIndex(recents, name) {
	if (!recents) {
		return -1
	}
	for (let i = 0; i < recents.length; i++) {
		if (name === recents[i]) {
			return i
		}
	}
	return -1
}

function matchSite(host) {
	let accts = []
	let dom = hostDomain(host)
	let sfx = "." + dom
	for (let i = 0; i < state.sites.length; i++) {
		let x = state.sites[i]
		if (x[0] === dom || x[0].endsWith(sfx)) {
			accts.push(x)
		}
	}

	let recents = state.recents[dom]
	accts.sort((a, b) => {
		// compare name
		if (a[1] === b[1]) {
			return 0
		}
		
		let ia = recentIndex(recents, a[1])
		let ib = recentIndex(recents, b[1])
		if (ia === 0) {
			return -1
		}
		if (ib === 0) {
			return 1
		}
		if (ia >= 0 && ib >= 0) {
			return ia - ib
		}
		if (ia >= 0) {
			return -1
		}
		if (ib >= 0) {
			return 1
		}
		
		if (a[1] < b[1]) {
			return -1
		}
		return 1
	})

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

function importSites(ss) {
	//console.log("importsites"); console.log(ss)
	for (let x of ss) {
		let [h, n, p] = x
		addSite(h, n, p)
	}
	return pushState()
		.catch(e => { console.log("importsites err"); console.log(e); })
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
	case "new":
		handleNewSite(req, sendResponse)
		break

	default:
		console.log("unknown req"); console.log(req)
		break
	}
	// to avoid "message port closed before a response was received"?
	return true
}

function enableContextMenu() {
	chrome.runtime.onMessage.addListener(handleMessage)

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
