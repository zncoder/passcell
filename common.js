function nonce(n) {
	let b = new Uint8Array(n)
	crypto.getRandomValues(b)
	return b
}

function int8n(n) {
	let max = 255-(256%n)
	let b = new Uint8Array(1)
	crypto.getRandomValues(b)
	while (b[0] > max) {
		crypto.getRandomValues(b)
	}
	return b[0] % n
}

const hexCharset = "0123456789abcdef"

function bytes2hex(b) {
	b = new Uint8Array(b)
	//console.log(b)
	let ss = new Array(b.length*2)
	for (let i = 0; i < b.length; i++) {
		let x = b[i]
		ss[i*2] = hexCharset[x>>4]
		ss[i*2+1] = hexCharset[x&0x0f]
	}
	return ss.join("")
}

function hex2bytes(s) {
	//console.log(s)
	let b = new Uint8Array(s.length / 2)
	for (let i = 0; i < s.length; i += 2) {
		let x = s.charCodeAt(i)
		x = x >= 97 ? x-87 : x-48 // 97 - a; 48 - 0
		let y = s.charCodeAt(i+1)
		y = y >= 97 ? y-87 : y-48
		b[i/2] = (x<<4) | y
	}
	return b
}

function s2b(s) {
	return new TextEncoder().encode(s)
}

function b2s(b) {
	return new TextDecoder().decode(b)
}

function seal(key, b) {
	let iv = nonce(12)
	return crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, b)
		.then(c => {return {ct: bytes2hex(c), iv: bytes2hex(iv)}})
}

function unseal(key, x) {
	let ct = hex2bytes(x.ct)
	let iv = hex2bytes(x.iv)
	return crypto.subtle.decrypt({name: "AES-GCM", iv: iv}, key, ct)
}

function empty(s) {
	return !s || s.length === 0
}

function tidyUrl(u) {
	let a = document.createElement("a")
	a.href = u
	return [a.protocol, a.host, a.pathname]
}

// password generator, special char is $
const pwCharset = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// pwMode:
// 0 - 32B, no special char
// 1 - 32B, special char
// 2 - 16B, no special char
// 3 - 16B, special char
// 4 - 8B, no special char
// 5 - 8B, special char
let pwMode = 0

function generatePw() {
	let len = 32
	switch (pwMode - pwMode%2) {
	case 0:
		len = 32
		break
	case 2:
		len = 16
		break
	case 4:
		len = 8
		break
	}

	let b = new Array(len)
	for (let i = 0; i < len; i++) {
		let x = int8n(pwCharset.length)
		b[i] = pwCharset.charAt(x)
	}

	let sc = (pwMode % 2) !== 0
	if (sc) {
		let x = int8n(len)
		b[x] = "$"
	}
	
	pwMode = (pwMode + 1) % 6
	return [b.join(""), len, sc]
}

function deriveBits(b, salt) {
	return crypto.subtle.importKey("raw", b, {name: "PBKDF2"}, false, ["deriveKey"])
		.then(mk => {
			let alg = {
				name: "PBKDF2",
				salt: salt,
				iterations: 1000,
				hash: "SHA-256"
			}
			return crypto.subtle.deriveKey(alg, mk, {name: "AES-GCM", length: 256}, true, ["encrypt"])
		})
		.then(k => crypto.subtle.exportKey("raw", k))
		.then(x => new Uint8Array(x))
}

function toKey(b) {
	return crypto.subtle.importKey("raw", b, {name: "AES-GCM"}, false, ["encrypt", "decrypt"])
}

function deriveSealKey(pw, salt) {
	return deriveBits(s2b(pw), salt)
		.then(b => toKey(b))
}

function deriveAuthCred(pw, em, salt) {
	let sk
	return deriveBits(s2b(pw), salt)
		.then(x => sk = x)
		.then(deriveBits(s2b(em+"authsalt"), salt))
		.then(asalt => deriveBits(sk, asalt))
		.then(b => bytes2hex(b))
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

function post(url, obj, timeout) {
	let ac = new AbortController()
	let arg = {
		method: "POST",
		cache: "no-cache",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(obj),
		signal: ac.signal,
	}
	let timeoutId = setTimeout(() => ac.abort(), timeout)
	
	return fetch(url, arg)
		.then(resp => {
			if (!resp.ok) {
				console.log("fetch err:" + resp.statusText)
				return Promise.reject(new Error(resp.statusText))
			}
			return resp.json()
		})
		.then(json => {
			clearTimeout(timeoutId)
			return json
		})
}

// exponential backoff between 1s and 300s.
// return new backoff upper bound
function backoff(delay) {
	// make sure delay is an integer in case of bug
	delay = delay || 1000
	if (delay < 1000) {
		delay = 1000
	} else {
		delay *= 2
		if (delay > 300*1000) {
			delay = 300*1000
		}
	}
	let x = Math.floor(Math.random() * (delay-100))+100 // min 100ms
	console.log(`backoff ${x} out of ${delay}`)
	return wait(x).then(() => delay)
}

function localGet(keys) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(keys, items => {
			if (chrome.runtime.lastError) {
				reject(Error(chrome.runtime.lastError.message))
				return
			}

			resolve(items)
		})
	})
}

function localSet(items) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.set(items, () => {
			if (chrome.runtime.lastError) {
				reject(Error(chrome.runtime.lastError.message))
				return
			}

			resolve(true)
		})
	})
}

function currentTab() {
	return new Promise(resolve => {
		chrome.tabs.query({active: true, currentWindow: true}, ts => resolve(ts[0]))
	})
}

function getBackgroundPage() {
	return new Promise(resolve => chrome.runtime.getBackgroundPage(bg => resolve(bg)))
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}
