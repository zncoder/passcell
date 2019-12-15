// TODO: 
// - notes
// - keep log of all changes in server
// - search a site
// - get form confirmed from executeScript

// rearchitecture
// - separate storage and password management
// - storage can be a general storage system available to other extensions
//    - authentication and encryption
//    - store diffset and help resolve conflicts

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
const prodBackend = "https://54.183.246.147.sslip.io:10008"
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
	pwGen: new PwGen(),

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

function pwGen() {
	return state.pwGen
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

async function loadPlaintextState() {
	try {
		let x = await localGet(["email", "mastersalt", "version", "recents", "noautologins"])
		//console.log("loadmastersalt"); console.log(x)
		if (!x.mastersalt) {
			return
		}
		state.masterSalt = hex2bytes(x.mastersalt)
		state.email = x.email
		state.version = x.version
		state.recents = x.recents || {}
		state.noautologins = new Set(x.noautologins || [])
	} catch(e) {
		console.log("loadplaintextstate err"); console.log(e);
	}
}

loadPlaintextState()						// no need to wait for it to finish?

async function signUp(em, pw) {
	// sign up,
	// upload state to server
	let salt = nonce(24)
	let [k, tk, tr] = await Promise.all([
		deriveSealKey(pw, salt),
		signUpRemote(state.backend, em, pw, salt),
		newTokener(state.backend, em, pw, salt)])
	state.masterKey = k
	state.token = tk
	state.email = em
	state.masterSalt = salt
	state.tokener = tr

	enableContextMenu()
	let ver = await pushState()
	onSignedIn()
	return ver
}

function onSignedIn() {
	// no return to unchain this promise.
	// watchRemote runs in its own promise chain forever.
	watchRemote()
}

async function signUpRemote(url, em, pw, salt) {
	let cred = await deriveAuthCred(pw, em, salt)
	let v = {
		email: em,
		mastersalt: bytes2hex(salt),
		cred: cred
	}
	let res = await post(url+"/signup", v, postTimeout)
	// console.log("signup res:"); console.log(res)
	return res.token
}

async function logIn(pw) {
	let k = await deriveSealKey(pw, state.masterSalt)
	await loadSealedState(k)
	let tr = await newTokener(state.backend, state.email, pw, state.masterSalt)
	state.tokener = tr
	await refreshToken()
	enableContextMenu()
	onSignedIn()
			
	if (state.diffset.length > 0) {
		return applyDiffs()
	}
}

class Tokener {
	constructor(url, arg) {
		this.url = url + "/login"
		this.arg = arg
	}

	async refresh() {
		let res = await post(this.url, this.arg, postTimeout)
		console.log(`got token ${res.token}`)
		return res.token
	}
}

async function newTokener(url, em, pw, salt) {
	let cred = await deriveAuthCred(pw, em, salt)
	//console.log("cred"); console.log(cred)
	let arg = {
		email: em,
		cred: cred
	}
	return new Tokener(url, arg)
}

async function refreshToken() {
	console.log("refreshtoken")
	state.token = await state.tokener.refresh()
	return state.token
}

async function recoverLogIn(em, pw) {
	let salt = await preLogInRemote(state.backend, em)
	let [k, tr] = await Promise.all([
		deriveSealKey(pw, salt),
		newTokener(state.backend, em, pw, salt)])
	let tk = await tr.refresh()
	state.masterKey = k
	state.token = tk
	state.masterSalt = salt
	state.email = em
	state.tokener = tr

	enableContextMenu()
	onSignedIn()
}

async function preLogInRemote(url, em) {
	let arg = {email: em}
	let res = await post(url+"/prelogin", arg, postTimeout)
	return hex2bytes(res.mastersalt)
}

async function watchRemote() {
	if (stopWatch) {
		console.log("stop remote watcher")
		return
	}

	await pullRemote(true)
	// apply diffs that are not committed.
	if (state.diffset.length > 0) {
		console.log(`apply ${state.diffset.length} diffs`)
		// catch errors to make sure watchRemote is chained
		try {
			await applyDiffs()
		} catch(e) {
			console.log("applydiffs after pull err:"); console.log(e)
		}
	}
	return watchRemote()
}

async function loadSealedState(key) {
	let x = await localGet(["sites", "diffset"])
	let [ss, ds] = await Promise.all([unsealObject(key, x.sites), unsealObject(key, x.diffset)])
	//console.log("state unsealed")
	state.masterKey = key
	state.sites = ss || []
	state.diffset = ds || []
}

async function unsealObject(key, s) {
	if (!s) {
		return []
	}
	let x = JSON.parse(s)
	//console.log("x"); console.log(x)
	let b = await unseal(key, x)
	return JSON.parse(b2s(b))
}

async function sealObject(key, ss) {
	let s = JSON.stringify(ss)
	let x = await seal(key, s2b(s))
	return JSON.stringify(x)
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
async function pushState() {
	// tie diffset with this push. retry would use the same end
	let end = state.base + state.diffset.length
	//console.log(`pushstate base:${state.base},end:${end}`)
	let [ct, ctds] = await Promise.all(
		[state.sites, state.diffset]
			.map(x => sealObject(state.masterKey, x)))
	await saveState(ct, ctds)
	return pushRemote(state.backend, state.token, state.version, ct, end, new Backoff())
}

async function pushStateNoError() {
	try {
		await pushState()
	} catch(e) {
		console.log("pushstate err"); console.log(e)
	}
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

async function saveDiffset() {
	let ctds = await sealObject(state.masterKey, state.diffset)
	return localSet({diffset: ctds})
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

async function pullRemote(wait) {
	let [ver, ct, ss] = await fetchRemote(state.backend, state.masterKey, state.token, state.version, wait, new Backoff())
	//console.log(`pullremote got version:${ver}`)
	if (ver <= state.version) {
		return
	}
			
	state.version = ver
	state.sites = ss
	return saveState(ct)
}

async function fetchRemote(url, k, tk, ver, wait, bo) {
	let arg = {
		token: tk,
		cur_version: ver,
		wait: wait,
	}

	let to = wait ? 90*1000 : 10*1000

	//console.log(`fetchremote with timeout:${to}`)
	try {
		let res = await post(url+"/get", arg, to)
		console.log(`fetchremote version:${res.version}`)
		let x = JSON.parse(res.value)
		let ss = await unsealObject(k, x.sites)
		return [res.version, x.sites, ss]
	} catch(e) {
		if (!retryOnErr) {
			console.log("fetchremote err"); console.log(e)
			throw e
		}
		tk = await backoffRefresh(tk, e, bo)
		return fetchRemote(url, k, tk, ver, wait, bo)
	}
}

async function backoffRefresh(tk, e, bo) {
	if (e.name === "AbortError") {
		// fetch aborted, no backoff and reset delay
		bo.reset()
		return tk
	}

	await bo.wait()
	if (e.message === "Unauthorized") {
		tk = await refreshToken()
	}
	return tk
}

async function pushRemote(url, tk, ver, ct, end, bo) {
	let s = JSON.stringify({sites: ct}) // save as object for future changes.
	let arg = {
		token: tk,
		prev_version: ver,
		value: s
	}

	try {
		let res = await post(url+"/put", arg, postTimeout)
		if (end > state.base) {
			console.log(`pushed version:${res.version}, truncate diffset from ${state.base} to ${end}`)
			state.diffset.splice(0, end - state.base)
			state.base = end
			return saveDiffset()
		} else {
			console.log(`diffset:${end} of version:${res.version} is superseded`)
		}
	} catch(e) {
		console.log(`pushremote at version:${ver},end:${end} err`); console.log(e)
		if (e.message === "Conflict") {
			// no retry on conflict version.
			// let pullremote retry push after get the latest version.
			console.log("conflict version")
			throw e
		}
		if (!retryOnErr) {
			console.log("pushremote err"); console.log(e)
			throw e
		}
		tk = await backoffRefresh(tk, e, bo)
		return pushRemote(url, tk, ver, ct, end, bo)
	}
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
	return pushStateNoError()
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

	return pushStateNoError()
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
		return true
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
// TODO: doesn't work for e.g. .com.cn hosts
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
	return pushStateNoError()
}

function importSites(ss) {
	//console.log("importsites"); console.log(ss)
	for (let x of ss) {
		let [h, n, p] = x
		addSite(h, n, p)
	}
	return pushStateNoError()
}

async function handleImportSites(ss, sendResponse) {
	try {
		await importSites(ss)
		sendResponse({response: "sites imported"})
	} catch(e) {
		console.log("handleimportsites err"); console.log(e)
	}
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
