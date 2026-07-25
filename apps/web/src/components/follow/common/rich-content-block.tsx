'use client'

/**
 * RichContentBlock — renders structured rich-content payloads (code blocks,
 * tables, callouts, file cards) emitted by the chat backend. Designed to fit
 * the floating unit's narrow width: tables horizontally scroll and code blocks
 * use a soft light theme to match the floating chat surface.
 */

import { useState } from 'react'
import type { RichContent } from '@workspace/shared/types'

export function RichContentBlock({ block }: { block: RichContent }) {
  switch (block.type) {
    case 'code_sandbox': {
      const data = block.data as { language: string; code: string }
      return <CodeBlock language={data.language} code={data.code} />
    }
    case 'table': {
      const data = block.data as { headers: string[]; rows: string[][] }
      return (
        <div className="my-2 overflow-x-auto rounded-lg border border-[#E8EAED]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E8EAED] bg-[#F8F9FA]">
                {data.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-[#5F6368]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-[#F1F3F4] last:border-b-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-[#3C4043]">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'callout': {
      const data = block.data as { variant: string; text: string }
      const variants: Record<string, string> = {
        info: 'border-blue-200 bg-blue-50 text-blue-900',
        warning: 'border-amber-200 bg-amber-50 text-amber-900',
        tip: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      }
      return (
        <div
          className={`my-2 rounded-lg border p-3 text-xs ${variants[data.variant] ?? variants['info']}`}
        >
          {data.text}
        </div>
      )
    }
    case 'file_card': {
      const data = block.data as { fileId: string; fileName: string; fileType: string }
      return (
        <div
          className="my-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#E8EAED] bg-[#F8F9FA] px-3 py-2 text-xs text-[#3C4043] transition-colors hover:bg-[#F1F3F4]"
          onClick={() => {
            if (typeof window !== 'undefined' && data.fileId) {
              window.dispatchEvent(
                new CustomEvent('follow-open-file', { detail: { fileId: data.fileId } })
              )
            }
          }}
        >
          <span>{'\uD83D\uDCC4'}</span>
          <span className="font-medium">{data.fileName}</span>
          <span className="text-[#9AA0A6]">{data.fileType}</span>
        </div>
      )
    }
    default:
      return null
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[#E8EAED]">
      <div className="flex items-center justify-between bg-[#F8F9FA] px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[#9AA0A6]">
          {language || 'code'}
        </span>
        <button onClick={handleCopy} className="text-[10px] text-[#5F6368] hover:text-[#202124]">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-[#FAFBFC] p-3">
        <code className={`text-xs leading-relaxed text-[#202124] language-${language}`}>
          {code}
        </code>
      </pre>
    </div>
  )
}
