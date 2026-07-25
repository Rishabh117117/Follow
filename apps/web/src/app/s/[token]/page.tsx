'use client'

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import { authFetch } from '@/lib/api-client'

interface SharedDoc {
  fileId: string
  workspaceId: string
  fileName: string
  tiptapContent: Record<string, unknown> | null
  permission: 'viewer' | 'editor'
}

async function fetchSharedDoc(token: string): Promise<SharedDoc | null> {
  const res = await authFetch(`/api/public/shared/${token}`)
  if (!res.ok) return null
  const body = await res.json()
  return body.data ?? null
}

export default function SharedDocPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const { status: sessionStatus } = useSession()

  const { data: doc, isLoading } = useQuery({
    queryKey: ['shared-doc', token],
    queryFn: () => fetchSharedDoc(token),
    enabled: !!token,
    retry: false,
  })

  const editor = useEditor({
    extensions: [StarterKit],
    content: doc?.tiptapContent ?? '',
    editable: false,
    immediatelyRender: false,
  })

  useEffect(() => {
    if (editor && doc?.tiptapContent) {
      editor.commands.setContent(doc.tiptapContent as object)
    }
  }, [editor, doc])

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--n100)' }}
      >
        <p className="text-[13px]" style={{ color: 'var(--n500)' }}>
          Loading document…
        </p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4"
        style={{ backgroundColor: 'var(--n100)' }}
      >
        <div className="w-full max-w-[440px] text-center">
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-[3px]"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              <span className="text-[11px] font-bold leading-none text-white">F</span>
            </div>
            <span
              className="text-[22px] leading-none"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Follow
            </span>
          </div>
          <div
            className="rounded-xl border bg-white p-8 shadow-sm"
            style={{ borderColor: 'var(--n200)' }}
          >
            <h1
              className="mb-2 text-[22px]"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Document not found
            </h1>
            <p className="mb-6 text-[13px]" style={{ color: 'var(--n500)' }}>
              This share link is no longer valid or the document has been removed.
            </p>
            <Link
              href="/"
              className="inline-flex rounded-lg px-4 py-2 text-[13px] font-medium text-white"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--n100)' }}>
      {/* Header */}
      <header className="border-b bg-white" style={{ borderColor: 'var(--n200)' }}>
        <div className="mx-auto flex max-w-[860px] items-center justify-between px-8 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-[3px]"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              <span className="text-[11px] font-bold leading-none text-white">F</span>
            </div>
            <span
              className="text-[18px] leading-none"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Follow
            </span>
          </Link>
          <span
            className="rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wider"
            style={{
              borderColor: 'var(--n200)',
              color: 'var(--n500)',
              backgroundColor: 'var(--n50)',
            }}
          >
            Read-only
          </span>
        </div>
      </header>

      {/* Document */}
      <main className="mx-auto max-w-[860px] px-8 py-10 pb-32">
        <h1
          className="mb-8 text-[32px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          {doc.fileName}
        </h1>
        <div
          className="shared-doc-content rounded-xl border bg-white p-10 shadow-sm"
          style={{ borderColor: 'var(--n200)' }}
        >
          <EditorContent editor={editor} />
        </div>
      </main>

      {/* Bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-white"
        style={{ borderColor: 'var(--n200)' }}
      >
        <div className="mx-auto flex max-w-[860px] items-center justify-between px-8 py-3">
          <p className="text-[12px]" style={{ color: 'var(--n500)' }}>
            {sessionStatus === 'authenticated'
              ? 'You&rsquo;re viewing this document in read-only mode.'
              : 'Sign up for Follow to edit and collaborate on documents.'}
          </p>
          {sessionStatus !== 'authenticated' && (
            <Link
              href="/auth/login"
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              Sign up to edit
            </Link>
          )}
        </div>
      </div>

      <style jsx global>{`
        .shared-doc-content .ProseMirror {
          outline: none;
          color: var(--n900);
          font-size: 14px;
          line-height: 1.7;
        }
        .shared-doc-content .ProseMirror h1 {
          font-family: Newsreader, Georgia, serif;
          font-size: 26px;
          font-weight: 500;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          color: var(--n950);
        }
        .shared-doc-content .ProseMirror h2 {
          font-family: Newsreader, Georgia, serif;
          font-size: 20px;
          font-weight: 500;
          margin-top: 1.4em;
          margin-bottom: 0.4em;
          color: var(--n950);
        }
        .shared-doc-content .ProseMirror h3 {
          font-family: Newsreader, Georgia, serif;
          font-size: 16px;
          font-weight: 500;
          margin-top: 1.2em;
          margin-bottom: 0.3em;
          color: var(--n950);
        }
        .shared-doc-content .ProseMirror p {
          margin-bottom: 0.9em;
        }
        .shared-doc-content .ProseMirror ul,
        .shared-doc-content .ProseMirror ol {
          padding-left: 1.5em;
          margin-bottom: 0.9em;
        }
        .shared-doc-content .ProseMirror strong {
          font-weight: 600;
          color: var(--n950);
        }
      `}</style>
    </div>
  )
}
