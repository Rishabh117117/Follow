import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      image?: string | null
      activeWorkspaceId?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    activeWorkspaceId?: string
  }
}
