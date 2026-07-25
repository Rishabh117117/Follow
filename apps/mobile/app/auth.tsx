import { useState } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import * as Google from 'expo-auth-session/providers/google'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import { setSession } from '@/lib/auth'
import { apiRequest } from '@/lib/api'
import { FollowMark } from '@/components/FollowMark'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

type ExtensionLoginResponse = {
  userId: string
  workspaceId: string
  email: string
  name: string
  avatarUrl?: string | null
}

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_CLIENT_ID_IOS = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? ''
const GOOGLE_CLIENT_ID_ANDROID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? ''
const GOOGLE_CLIENT_ID_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? ''

export default function AuthScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const [, , promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_CLIENT_ID_IOS || undefined,
    androidClientId: GOOGLE_CLIENT_ID_ANDROID || undefined,
    webClientId: GOOGLE_CLIENT_ID_WEB || undefined,
    redirectUri: AuthSession.makeRedirectUri({ scheme: 'follow' }),
  })

  async function onGoogleSignIn() {
    setLoading(true)
    try {
      // Dev fallback: when no Google client IDs are configured and the backend
      // is running with DEV_BYPASS_AUTH=true, a blank user id still resolves
      // via the dev user. We use the known dev user id from @workspace/shared.
      if (!GOOGLE_CLIENT_ID_IOS && !GOOGLE_CLIENT_ID_ANDROID && !GOOGLE_CLIENT_ID_WEB) {
        await setSession({
          id: DEV_USER.id,
          name: DEV_USER.name,
          email: DEV_USER.email,
          avatarUrl: DEV_USER.avatarUrl,
          workspaceId: DEV_WORKSPACE.id,
        })
        router.replace('/(tabs)/chats')
        return
      }

      const result = await promptAsync()
      if (result.type !== 'success') {
        setLoading(false)
        return
      }
      const accessToken = result.authentication?.accessToken
      if (!accessToken) {
        Alert.alert('Sign-in failed', 'No token returned from Google.')
        setLoading(false)
        return
      }

      // Exchange Google access token for a Follow session via the backend.
      const data = await apiRequest<ExtensionLoginResponse>(
        '/api/auth/extension-login',
        {
          method: 'POST',
          anonymous: true,
          body: { googleAccessToken: accessToken },
        },
      )

      await setSession({
        id: data.userId,
        workspaceId: data.workspaceId,
        name: data.name,
        email: data.email,
        avatarUrl: data.avatarUrl ?? null,
      })
      router.replace('/(tabs)/chats')
    } catch (err) {
      Alert.alert(
        'Sign-in failed',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <FollowMark size={72} />
        <Text style={styles.wordmark}>Follow</Text>
        <Text style={styles.tagline}>Writing that learns you.</Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        disabled={loading}
        onPress={onGoogleSignIn}
      >
        {loading ? (
          <ActivityIndicator color={colors.paper} />
        ) : (
          <Text style={styles.buttonText}>Continue with Google</Text>
        )}
      </Pressable>

      <Text style={styles.footer}>
        By continuing you agree to Follow&apos;s terms and privacy policy.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xxl * 2 },
  wordmark: {
    fontFamily: 'serif',
    fontSize: fontSize.display,
    color: colors.ink,
    marginTop: spacing.md,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: fontSize.md,
    color: colors.n500,
    marginTop: spacing.xs,
  },
  button: {
    backgroundColor: colors.ink,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    minWidth: 280,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: colors.paper,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: spacing.xl,
    fontSize: fontSize.xs,
    color: colors.n400,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
})
