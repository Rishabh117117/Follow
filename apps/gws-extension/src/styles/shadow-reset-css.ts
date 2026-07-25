/**
 * CSS reset for shadow DOM isolation.
 * Ensures Follow's UI is not affected by Google Docs' global styles.
 * Exported as a string for injection into the shadow DOM.
 */

export const SHADOW_RESET_CSS = `
/* ─── Shadow DOM Reset ─────────────────────────────────────────────────── */

:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #202124;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

button {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  cursor: pointer;
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  outline: none;
}

button:focus-visible {
  outline: 2px solid #6366F1;
  outline-offset: 2px;
  border-radius: 4px;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  border: none;
  background: none;
  outline: none;
  padding: 0;
  margin: 0;
}

textarea {
  resize: none;
}

a {
  color: inherit;
  text-decoration: none;
}

img, svg {
  display: block;
  max-width: 100%;
}

/* Scrollbar styles */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #DADCE0;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9AA0A6;
}
`
