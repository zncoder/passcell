getBackgroundPage()
	.then(bg => {
		bg.ready().then(() => {
			let sites = bg.getSites();
			hydrateSites(sites);
		});
	});

const siteTmpl = '<td>{host}</td><td>{name}</td><td>{pw}</td>';

function hydrateSites(sites) {
	let tb = docId("sites-tb");
	for (let x of sites) {
		let h = x[0];
		let n = x[1];
		let p = x[2];

		let tr = document.createElement("tr");
		tr.classList.add("acct_row");
		tr.innerHTML = siteTmpl.replace(/{host}/g, h)
			.replace(/{name}/g, n)
			.replace(/{pw}/g, p);
		tb.appendChild(tr);
	}
}
