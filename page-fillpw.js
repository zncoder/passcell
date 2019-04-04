// this script is injected by popup.
// inited is set to true on first injection.
var inited,
		bgColor,
		valueMark

// need <all_urls> permission to deal with cross-origin iframes
function init() {
	if (inited) {
		return
	}
	inited = true
	console.log("page-fillpw inited")

	bgColor = "#FDFF47"
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
		sendResponse({name: nval})
		break
	}
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

function showTip(s) {
	let div = document.createElement("div")
	div.innerText = s
	div.style.position = "absolute"
	div.style.top = "0"
	div.style.left = "50%"
	div.style.zIndex = 1
	div.style.backgroundColor = bgColor

	document.body.appendChild(div)
	return div
}

function stopTip(tip) {
	document.body.removeChild(tip)
}

//// dead code ////

function locateNamePwFields() {
	// find the pw field,
	// - if only 1 visible pw field, use it
	// - if multiple visible pw fields, start picker
	// - first invisible pw field
	//
	// once pw field is found, locate the name field
	return Promise.resolve(locatePwField())
		.then(x => {
			if (!x) {
				return pickPw().then(pw => [pw, true])
			}
			return x
		})
		.then(x => {
			let res = {pw: x[0], confirmed: x[1]}
			let name = locateNameField(res.pw)
			if (name) {
				res.name = name
			}
			return res
		})
}

// pickPw triggers picking pw field with mouse, and returns a Promise of the pw field
function pickPw() {
	return new Promise(resolve => {
		let pk = newPicker(resolve)
		pk.start()
	})
}

function newPicker(resolve) {
	let picker = {resolve: resolve}
	// removeEventListener requires external function
	picker.onMouseOver = ev => {
		//console.log("over"); console.log(ev.target)
		if (ev.target.type !== "password") {
			return
		}
		picker.bgColor = ev.target.style.backgroundColor
		//console.log("set bgcolor to"); console.log(picker.bgColor)
		ev.target.style.backgroundColor = bgColor
	}
	
	picker.onMouseOut = ev => {
		//console.log("out"); console.log(ev.target)
		if (ev.target.type !== "password") {
			return
		}
		if (picker.bgColor !== undefined) {
			//console.log("reset color")
			ev.target.style.backgroundColor = picker.bgColor
			picker.bgColor = undefined
		}
	}
	
	picker.onClick = ev => {
		//console.log("click")
		// stop picker on any click event
		picker.onMouseOut(ev)
		picker.stop()
		
		// left click only
		if (ev.button != 0) {
			picker.resolve(null)
		}

		let pw = ev.target
		if (pw.type !== "password") {
			console.log("ignore non-password:"); console.log(pw)
			picker.resolve(null)
			return
		}
		//console.log("pw"); console.log(pw)
		picker.resolve(pw)
	}
	
	picker.start = () => {
		//console.log("start picker")
		picker.tip = showTip("Please click to select the password field")
		// TODO: highlight all pw fields?
		document.body.style.cursor = "grab"
		document.addEventListener("mouseover", picker.onMouseOver)
		document.addEventListener("mouseout", picker.onMouseOut)
		document.addEventListener("click", picker.onClick)
	}
	
	picker.stop = () => {
		//console.log("stop picker")
		stopTip(picker.tip)
		document.body.style.cursor = "initial"
		document.removeEventListener("mouseover", picker.onMouseOver)
		document.removeEventListener("mouseout", picker.onMouseOut)
		document.removeEventListener("click", picker.onClick)
	}

	return picker
}

function locateNameField(pw) {
	// search backward from pw to find the name field
	let ins = pw.form.getElementsByTagName("input")
	let i = 0
	for (; i < ins.length; i++) {
		if (ins[i] === pw) {
			break
		}
	}
	if (i === ins.length) {
		return null
	}
	for (; i >= 0; i--) {
		let x = ins[i]
		if ((x.type === 'text' || x.type === 'email') && visible(x)) {
			return x
		}
	}
	return null
}

function queryPwAll() {
	let pws = []
	let ins = document.querySelectorAll("input")
	for (let x of ins) {
		if (x.type === "password") {
			pws.push(x)
		}
	}
	return pws
}

// return [pw, confirmed] or null
function locatePwField() {
	let pwinv, pw
	let pwall = queryPwAll()
	for (let x of pwall) {
		if (visible(x)) {
			if (pw) {
				console.log("multiple visible passwords")
				return null
			}
			pw = x
		} else if (!pwinv) {
			pwinv = x
		}
	}
	if (pw) {
		return [pw, true]
	}
	if (pwinv) {
		return [pwinv, false]
	}
	return null
}

init()
