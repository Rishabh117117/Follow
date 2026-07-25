/**
 * Notebook editor stub. The notebook editor surface was removed with the
 * parked feature strip; notebook items can still appear in the Items view,
 * so this route stays as a graceful landing instead of a 404.
 */
export default function NotebookPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <p className="text-sm" style={{ color: 'var(--n400, #a3a3a3)' }}>
          The notebook editor has been archived.
        </p>
        <p className="text-xs" style={{ color: 'var(--n300, #d4d4d4)' }}>
          Notebook content remains stored in the workspace.
        </p>
      </div>
    </div>
  )
}
