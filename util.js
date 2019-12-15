// todo:
// - make pwgen an object

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

async function seal(key, b) {
	let iv = nonce(12)
	let c = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, b)
	return {ct: bytes2hex(c), iv: bytes2hex(iv)}
}

function unseal(key, x) {
	let ct = hex2bytes(x.ct)
	let iv = hex2bytes(x.iv)
	return crypto.subtle.decrypt({name: "AES-GCM", iv: iv}, key, ct)
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

async function deriveBits(b, salt) {
	let mk = await crypto.subtle.importKey("raw", b, {name: "PBKDF2"}, false, ["deriveKey"])
	let alg = {
		name: "PBKDF2",
		salt: salt,
		iterations: 1000,
		hash: "SHA-256"
	}
	let k = await crypto.subtle.deriveKey(alg, mk, {name: "AES-GCM", length: 256}, true, ["encrypt"])
	let x = await crypto.subtle.exportKey("raw", k)
	return new Uint8Array(x)
}

function toKey(b) {
	return crypto.subtle.importKey("raw", b, {name: "AES-GCM"}, false, ["encrypt", "decrypt"])
}

async function deriveSealKey(pw, salt) {
	let b = await deriveBits(s2b(pw), salt)
	return toKey(b)
}

async function deriveAuthCred(pw, em, salt) {
	let [sk, asalt] = await Promise.all([
		deriveBits(s2b(pw), salt),
		deriveBits(s2b(em+"authsalt"), salt)])
	// BUG: in previous version.
	//    let sk
	//    ...
	//    .then(x => sk = x)
	//    ...
	//    .then(asalt => ...)
	// asalt and sk are the same object.
	//
	// to fix this transparently, we need to send both auth creds to the server,
	// and let server compare both auth creds with the saved auth cred,
	// and update the saved auth creds if the old one matches.
	//let b = await deriveBits(sk, asalt)
	let b = await deriveBits(sk, sk)
	return bytes2hex(b)
}

async function post(url, obj, timeout) {
	let ac = new AbortController()
	let arg = {
		method: "POST",
		cache: "no-cache",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(obj),
		signal: ac.signal,
	}
	let timeoutId = setTimeout(() => ac.abort(), timeout)

	try {
		let resp = await fetch(url, arg)
		if (!resp.ok) {
			throw new Error(`resp not ok:${resp.statusText}`)
		}
		return await resp.json()
	} catch (e) {
		console.log(`fetch err:${e}`)
		throw e
	} finally {
		clearTimeout(timeoutId)
	}
}

// exponential backoff between 1s and 300s.
class Backoff {
	constructor() {
		this.delay = 0
	}

	wait() {
		this.delay = this.delay || 1000
		if (this.delay < 1000) {
			this.delay = 1000
		} else {
			this.delay *= 2
			if (this.delay > 300*1000) {
				this.delay = 300*1000
			}
		}
		let x = Math.floor(Math.random() * (this.delay-100))+100 // min 100ms
		console.log(`backoff ${x} out of ${this.delay}`)

		return wait(x)
	}

	reset() {
		this.delay = 0
	}
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

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}
