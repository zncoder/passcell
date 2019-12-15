// this script is injected by popup.
// inited is set to true on first injection.
var inited,
		valueMark

// need <all_urls> permission to deal with cross-origin iframes
function init() {
	if (inited) {
		return
	}
	inited = true
	console.log("page-fillpw inited")

	valueMark = "_value_set_by_furyomaiifndduzn_"
	chrome.runtime.onMessage.addListener(handleMessage)
}

function handleMessage(req, sender, sendResponse) {
	let state = initState()
	if (state.forms.length === 0) {
		//console.log("no form found")
		return
	}
	fillForm(state, req, sendResponse)
}

function fillForm(state, req, sendResponse) {
	//console.log("req"); console.log(req)
	if (req.name) {
		for (let x of state.forms) {
			for (let y of x.name) {
				setFieldValue(y, req.name)
			}
			if (req.hidden) {
				for (let y of x.hidden) {
					setFieldValue(y, req.name)
				}
			}
		}
	}

	let pwset = []
	if (req.pw) {
		for (let x of state.forms) {
			for (let ar of [x.visible, x.invisible]) {
				for (let y of ar) {
					if (setFieldValue(y, req.pw)) {
						let name = getNameValue(x.name)
						pwset.push([name, y])
					}
				}
			}
		}
	}

	let resp = {}
	// no action means fill the form only
	switch (req.action) {
	case "submit":
		// fill and then submit form
		if (state.confirmed) {
			submitForm(state)
		}
		break

	case "new":
		// new account, capture submit
		if (!state.notified) {
			state.notified = true
			for (let i = 0; i < pwset.length; i++) {
				let np = pwset[i]
				let pw = np[1]
				if (pw.form) {
					pw.form.addEventListener("submit", () => notifyNewAccount(np))
				}
			}
		}
		// find name to send back
		let nval = ""
		for (let np of pwset) {
			if (np[0] !== "") {
				nval = np[0]
				break
			}
		}
		//console.log("send back name"); console.log(nval)
		resp = {name: nval}
		break
	}
	sendResponse(resp)
}

function setFieldValue(field, value) {
	if (!field.value || field.value === "" || field.classList.contains(valueMark)) {
		field.value = value
		field.dispatchEvent(new Event("input", {"bubbles": true, "cancelable": true}))
		field.dispatchEvent(new Event("change"))
		field.classList.add(valueMark)
		return true
	}
	return false
}

function getNameValue(fields) {
	for (let x of fields) {
		if (x.value && x.value !== "" && !x.classList.contains(valueMark)) {
			return x.value
		}
	}
	return ""
}

function submitForm(state) {
	let fm = state.confirmed
	let submit = fm.querySelector("input[type=submit]") || fm.querySelector("button[type=submit]")
	if (submit) {
		submit.click()
	} else {
		fm.submit()
	}
}

function notifyNewAccount(np) {
	let [name, pw] = np
	let msg = {
		action: "new",
		host: window.location.host,
		name: name,
		pw: pw.value
	}
	//console.log("msg"); console.log(msg)
	chrome.runtime.sendMessage(msg)
}

function initState() {
	let state = {forms: locateForms()}

	// confirmed if there is only one visible form
	let fm
	for (let x of state.forms) {
		if (x.visible.length > 0) {
			if (fm) {
				fm = undefined
				break
			}
			if (x.visible[0].form) {
				fm = x.visible[0].form
			}
		}
	}
	state.confirmed = fm
	//console.log("state"); console.log(state)
	return state
}

// Locate forms that contain pw. If no form with pw is found, return
// forms with text or email fields.
//
// return [{name: [name_field], hidden: [name_field], visible: [visible_pw_field], invisible: [invisible_pw_field]}
// each element is a form.
// a form can contain 1 or more name field and 1 or more pw fields.
// name field is text or email input; pw is password input.
function locateForms() {
	let res = []
	let textonly = []
	// first locate pw and name fields in all forms
	for (let el of document.querySelectorAll("form")) {
		let fm = locateOneForm(el.querySelectorAll("input"))
		sortForms(res, textonly, fm)
	}

	// then locate pw and name fields that are not in any form, and put them in one form
	let ins = []
	for (let x of document.querySelectorAll("input")) {
		if (x.form) {
			continue
		}
		ins.push(x)
	}
	if (ins.length > 0) {
		let fm = locateOneForm(ins)
		sortForms(res, textonly, fm)
	}

	if (res.length > 0) {
		return res
	}
	return textonly
}

function sortForms(withpw, textonly, fm) {
	if (!fm) {
		return
	}
	if (fm.visible.length > 0 || fm.invisible.length > 0) {
		withpw.push(fm)
	} else {
		textonly.push(fm)
	}
}

function locateOneForm(ins) {
	let fm = {name: [], hidden: [], visible: [], invisible: []}
	for (let x of ins) {
		if (x.type === "password") {
			if (visible(x)) {
				fm.visible.push(x)
			} else {
				fm.invisible.push(x)
			}
		} else if ((x.type === "text" || x.type === "email")) {
			if (visible(x)) {
				fm.name.push(x)
			} else {
				fm.hidden.push(x)
			}
		}
	}
	return fm
}

// https://stackoverflow.com/a/41698614
function visible(el) {
	if (el.style.display === 'none' ||
			el.style.visibility === 'hidden' || el.style.visibility === 'collapse' ||
			(el.style.opacity > 0 && el.style.opacity < 0.1) ||
			el.offsetLeft < 0 ||
			el.style.zIndex < 0) {
		return false
	}

	let rect = el.getBoundingClientRect()
	if (el.offsetWidth + el.offsetHeight + rect.height + rect.width === 0) {
    return false
  }
	let cx = rect.left + el.offsetWidth / 2
	let cy = rect.top + el.offsetHeight / 2
	if (cx < 0 ||
			cx > (document.documentElement.clientWidth || window.innerWidth) ||
			cy < 0 ||
			cy > (document.documentElement.clientHeight || window.innerHeight)) {
		return false
	}
	return true
}

init()
