/**
 * Doc Intel PDF — detects PDF pages and shows "Analyze PDF" button.
 *
 * Ported from doc-intel-pdf.js (305 lines → ~80 lines).
 */

import { getAuth } from '@/core/storage'

let buttonHost: HTMLElement | null = null

export function detectPdfPage(): { isPdf: boolean; pdfUrl: string | null } {
  const url = window.location.href
  if (/\.pdf(\?[^#]*)?($|#)/i.test(url)) return { isPdf: true, pdfUrl: url }
  if (document.contentType === 'application/pdf') return { isPdf: true, pdfUrl: url }

  const chromeEmbed = document.querySelector('embed#plugin') as HTMLEmbedElement
  if (chromeEmbed?.type === 'application/x-google-chrome-pdf') return { isPdf: true, pdfUrl: chromeEmbed.src || url }

  const embed = document.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement
  if (embed) return { isPdf: true, pdfUrl: embed.src || url }

  return { isPdf: false, pdfUrl: null }
}

export async function showPdfButton(pdfUrl: string): Promise<void> {
  if (buttonHost) return
  if (sessionStorage.getItem('wa-pdf-dismissed')) return

  buttonHost = document.createElement('div')
  buttonHost.style.cssText = 'all:initial;position:fixed;z-index:2147483646;pointer-events:none;'
  const shadow = buttonHost.attachShadow({ mode: 'closed' })

  const container = document.createElement('div')
  container.style.cssText = `
    position:fixed;bottom:24px;right:24px;display:flex;align-items:center;gap:8px;
    pointer-events:auto;
  `

  const btn = document.createElement('button')
  btn.textContent = 'Analyze PDF'
  btn.style.cssText = `
    padding:10px 16px;border:none;border-radius:8px;background:#6366F1;color:#fff;
    font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  `
  btn.addEventListener('click', async () => {
    const auth = await getAuth()
    const webUrl = auth.apiBaseUrl.replace(':3001', ':3000')
    const name = pdfUrl.split('/').pop()?.split('?')[0] || 'document.pdf'
    window.open(`${webUrl}/pdf-viewer?url=${encodeURIComponent(pdfUrl)}&name=${encodeURIComponent(name)}`, '_blank')
  })

  const dismiss = document.createElement('button')
  dismiss.textContent = '\u00D7'
  dismiss.style.cssText = `
    width:28px;height:28px;border:none;border-radius:50%;background:#374151;color:#e4e4e7;
    font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  `
  dismiss.addEventListener('click', () => {
    buttonHost?.remove()
    buttonHost = null
    sessionStorage.setItem('wa-pdf-dismissed', '1')
  })

  container.appendChild(btn)
  container.appendChild(dismiss)
  shadow.appendChild(container)
  document.body.appendChild(buttonHost)
}

export function destroyPdfButton(): void {
  buttonHost?.remove()
  buttonHost = null
}
