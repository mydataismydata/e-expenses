/* ---------------------------------------------------------------------------
   Clean grids: theme switch
   ---------------------------------------------------------------------------
   Puts data-theme="light" or "dark" on <html>. The reader picks light, dark
   or system; system follows the device and changes with it. The choice is
   kept in this browser only.

   Load it in <head>, before the stylesheets paint, so a dark page never
   flashes white:

     <script src="theme.js"></script>

   Any button with data-theme-set="light|dark|system" becomes a switch, and
   carries aria-pressed for the choice in force. From script:

     gridsTheme.set('dark');   gridsTheme.get();   // 'light' | 'dark' | 'system'

   Printing always uses the light theme.
--------------------------------------------------------------------------- */

(function () {
	var KEY = 'grids.theme';
	var root = document.documentElement;
	var media = window.matchMedia('(prefers-color-scheme: dark)');

	function read() {
		try {
			var v = localStorage.getItem(KEY);
			return v === 'light' || v === 'dark' ? v : 'system';
		} catch (e) {
			return 'system';
		}
	}
	var current = read();

	function get() {
		return current;
	}

	function apply(choice) {
		var dark = choice === 'dark' || (choice === 'system' && media.matches);
		root.setAttribute('data-theme', dark ? 'dark' : 'light');
		var buttons = document.querySelectorAll('[data-theme-set]');
		for (var i = 0; i < buttons.length; i++) {
			buttons[i].setAttribute('aria-pressed', String(buttons[i].dataset.themeSet === choice));
		}
	}

	function set(choice) {
		current = choice;
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch (e) {
			/* Storage refused: the choice lasts until the page closes. */
		}
		apply(choice);
	}

	apply(current);

	media.addEventListener('change', function () {
		if (current === 'system') apply('system');
	});

	window.addEventListener('beforeprint', function () {
		root.setAttribute('data-theme', 'light');
	});
	window.addEventListener('afterprint', function () {
		apply(current);
	});

	document.addEventListener('click', function (e) {
		var b = e.target.closest && e.target.closest('[data-theme-set]');
		if (b) set(b.dataset.themeSet);
	});
	document.addEventListener('DOMContentLoaded', function () {
		apply(current);
	});

	window.gridsTheme = { get: get, set: set };
})();
