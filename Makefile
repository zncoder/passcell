zip:
	@grep -q "backend: prodBackend" background.js || (echo not prodBackend; exit 1)
	-rm passcell.zip
	7zz a passcell.zip *
