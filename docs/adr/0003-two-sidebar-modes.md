# The sidebar has two modes: an Auto-hide overlay and a Docked side panel

Arc-style auto-hide needs the sidebar to appear on hover and slide over the page. Chrome's side panel only opens on a click or key press, and it resizes the page. So Auto-hide is an overlay injected into each page: a thin strip at the window's left edge slides the sidebar in on hover and hides it when the mouse leaves. Docked is Chrome's side panel. Both load the same sidebar page, and one shortcut switches between them.

Auto-hide is the default, but its "all websites" permission is optional and requested during onboarding, so installing shows no broad warning. Users who decline get Docked. On pages where content scripts can't run (chrome:// pages, the new tab page, the Web Store, PDFs, other extensions' pages), the shortcut opens the side panel instead.

Auto-hide appears on whichever side the user has chosen for Chrome's side panel, so both modes share one edge. We rejected replacing Chrome's new tab page in v1, even though it would let Auto-hide work there: it clashes with other new-tab extensions, and Chrome warns users about the change.
