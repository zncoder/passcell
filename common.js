function nonce(n) {
	let b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

function int8n(n) {
	let max = 255-(256%n);
	let b = new Uint8Array(1);
	crypto.getRandomValues(b);
	while (b[0] > max) {
		crypto.getRandomValues(b);
	}
	return b[0] % n;
}

const hexCharset = "0123456789abcdef";

function bytes2hex(b) {
	b = new Uint8Array(b);
	//console.log(b);
	let ss = new Array(b.length*2);
	for (let i = 0; i < b.length; i++) {
		let x = b[i];
		ss[i*2] = hexCharset[x>>4];
		ss[i*2+1] = hexCharset[x&0x0f];
	}
	return ss.join("");
}

function hex2bytes(s) {
	//console.log(s);
	let b = new Uint8Array(s.length / 2);
	for (let i = 0; i < s.length; i += 2) {
		let x = s.charCodeAt(i);
		x = x >= 97 ? x-87 : x-48; // 97 - a; 48 - 0
		let y = s.charCodeAt(i+1);
		y = y >= 97 ? y-87 : y-48;
		b[i/2] = (x<<4) | y;
	}
	return b;
}

function s2b(s) {
	return new TextEncoder().encode(s);
}

function b2s(b) {
	return new TextDecoder().decode(b)
}

function seal(key, b) {
	let iv = nonce(12);
	return crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, b)
		.then(b => { return {ct: bytes2hex(b), iv: bytes2hex(iv)}; });
}

function unseal(key, x) {
	let ct = hex2bytes(x.ct);
	let iv = hex2bytes(x.iv);
	return crypto.subtle.decrypt({name: "AES-GCM", iv: iv}, key, ct);
}

function empty(s) {
	return !s || s.length === 0;
}

function tidyUrl(u) {
	let a = document.createElement("a");
	a.href = u;
	return [a.protocol, a.host, a.pathname];
}

// password generator, special char is $
const pwCharset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// mode: 0: a-z; 1: a-zA-Z; 2: a-zA-Z0-9; 3: a-zA-Z0-9$
function generatePw(mode, len) {
	let n = 26;
	switch (mode) {
	case 0:
		break;
	case 1:
		n = 26*2;
		break;
	default:
		n = 26*2+10;
	}

	let b = [];
	for (let i = 0; i < len; i++) {
		let x = int8n(n);
		b.push(pwCharset.charAt(x));
	}

	if (mode == 3) {
		let x = int8n(len);
		b[x] = "$";
	}
	return b.join("");
}

function rotatePwMode(mode) {
	mode++;
	if (mode > 3) {
		mode = 0;
	}
	return mode;
}

function rotatePwLen(n) {
	n -= 8;
	if (n < 8) {
		n = 32;
	}
	return n;
}

function deriveBits(b, salt) {
	return crypto.subtle.importKey("raw", b, {name: "PBKDF2"}, false, ["deriveKey"])
		.then(mk => {
			let alg = {
				name: "PBKDF2",
				salt: salt,
				iterations: 1000,
				hash: "SHA-256"
			};
			return crypto.subtle.deriveKey(alg, mk, {name: "AES-GCM", length: 256}, true, ["encrypt"]);
		})
		.then(k => crypto.subtle.exportKey("raw", k))
		.then(x => new Uint8Array(x));
}

function toKey(b) {
	return crypto.subtle.importKey("raw", b, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
}

function deriveSealKey(pw, salt) {
	return deriveBits(s2b(pw), salt)
		.then(b => toKey(b));
}

function deriveAuthCred(pw, em, salt) {
	let sk;
	return deriveBits(s2b(pw), salt)
		.then(x => sk = x)
		.then(deriveBits(s2b(em+"authsalt"), salt))
		.then(asalt => deriveBits(sk, asalt))
		.then(b => bytes2hex(b));
}

function docId(x) {	return document.getElementById(x); }

function show(id) {
	docId(id).style.display = "block";
}

function hide(id) {
	docId(id).style.display = "none";
}

function xhr(url, obj, to) {
	return new Promise((resolve, reject) => {
		let req = new XMLHttpRequest();
		if (obj) {
			req.open("POST", url, true);
			req.setRequestHeader("Content-Type", "application/json");
		} else {
			req.open("GET", url, true);
		}

		if (to === undefined) {
			req.timeout =  5000;
		} else {
			req.timeout = to;
		}

		req.onload = () => {
			//console.log("xhr done:"+req.status);
			if (req.status !== 200) {
				reject(Error(req.statusText));
				return;
			}

			let res = JSON.parse(req.response);
			//console.log(res);
			resolve(res);
		};
		
		req.onerror = e => {
			reject(Error("xhr network error"));
		};

		req.ontimeout = e => {
			reject(Error("xhr timeout"));
		};

		if (obj) {
			req.send(JSON.stringify(obj));
		} else {
			req.send();
		}
	});
}

// exponential backoff, return new backoff upper bound
function backoff(ms) {
	if (ms < 1000) {
		ms = 1000;
	} else {
		ms *= 2;
		if (ms > 300*1000) {
			ms = 300*1000;
		}
	}
	let x = Math.floor(Math.random() * (ms-100))+100; // min 100ms 
	console.log("backoff "+x+"ms/"+ms+"ms")
	return wait(x).then(() => ms);
}

function localGet(keys) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(keys, items => {
			if (chrome.runtime.lastError) {
				reject(Error(chrome.runtime.lastError.message));
				return;
			}

			resolve(items);
		});
	});
}

function localSet(items) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.set(items, () => {
			if (chrome.runtime.lastError) {
				reject(Error(chrome.runtime.lastError.message));
				return;
			}

			resolve(true);
		});
	});
}

function getBackgroundPage() {
	return new Promise(resolve => chrome.runtime.getBackgroundPage(bg => resolve(bg)));
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
