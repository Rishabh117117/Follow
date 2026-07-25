/**
 * Follow extension styles — includes animations, typography tokens,
 * and component styles for the shadow DOM.
 * Exported as a string for injection into the shadow DOM.
 */

export const EXTENSION_CSS = `
/* ─── CSS Keyframe Animations (from follow-animations.ts) ──────────────── */

@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOutRight {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(100%); opacity: 0; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideDown {
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes scaleOut {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.9); opacity: 0; }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes ping {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ─── Utility Classes ──────────────────────────────────────────────────── */

.follow-animate-scale-in {
  animation: scaleIn 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.follow-animate-fade-in {
  animation: fadeIn 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.follow-animate-slide-up {
  animation: slideUp 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.follow-animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.follow-animate-spin {
  animation: spin 1s linear infinite;
}

.follow-animate-ping {
  animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
}

.follow-animate-blink {
  animation: blink 1s step-end infinite;
}

/* ─── Follow Typography ────────────────────────────────────────────────── */

.follow-text-xs { font-size: 11px; line-height: 16px; }
.follow-text-sm { font-size: 13px; line-height: 20px; }
.follow-text-base { font-size: 14px; line-height: 22px; }

.follow-font-medium { font-weight: 500; }
.follow-font-semibold { font-weight: 600; }
.follow-font-bold { font-weight: 700; }

/* ─── Pointer Events ───────────────────────────────────────────────────── */

.follow-interactive {
  pointer-events: auto;
}

.follow-passthrough {
  pointer-events: none;
}

/* ─── Chat Markdown Styles ─────────────────────────────────────────────── */

.follow-chat-markdown p {
  margin-bottom: 8px;
}

.follow-chat-markdown p:last-child {
  margin-bottom: 0;
}

.follow-chat-markdown strong {
  font-weight: 600;
}

.follow-chat-markdown em {
  font-style: italic;
}

.follow-chat-markdown code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
}

.follow-chat-markdown pre {
  background: #1E1E1E;
  color: #D4D4D4;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
}

.follow-chat-markdown pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.follow-chat-markdown ul, .follow-chat-markdown ol {
  padding-left: 20px;
  margin: 4px 0;
}

.follow-chat-markdown li {
  margin-bottom: 2px;
}

.follow-chat-markdown a {
  color: #1A73E8;
  text-decoration: underline;
}

.follow-chat-markdown h1, .follow-chat-markdown h2, .follow-chat-markdown h3 {
  font-weight: 600;
  margin: 12px 0 4px;
}

.follow-chat-markdown h1 { font-size: 18px; }
.follow-chat-markdown h2 { font-size: 16px; }
.follow-chat-markdown h3 { font-size: 14px; }

.follow-chat-markdown blockquote {
  border-left: 3px solid #DADCE0;
  padding-left: 12px;
  color: #5F6368;
  margin: 8px 0;
}

/* ─── Transition Helpers ───────────────────────────────────────────────── */

.follow-transition-all {
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.follow-transition-colors {
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.follow-transition-transform {
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
`
