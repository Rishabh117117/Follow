import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

export default async function HomePage() {
  if (DEV_BYPASS_AUTH) {
    redirect(`/workspace/${DEV_WORKSPACE.id}`)
  }

  const session = await auth()

  if (!session) {
    redirect('/auth/login')
  }

  redirect('/workspace')
}
