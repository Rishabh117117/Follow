import { useEffect, useState } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { hasSession } from '@/lib/auth'
import { registerForPushNotifications } from '@/lib/push'
import { colors } from '@/theme/colors'

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    let mounted = true
    hasSession()
      .then((v) => {
        if (!mounted) return
        setSignedIn(v)
        setReady(true)
      })
      .catch(() => {
        if (!mounted) return
        setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const inAuthGroup = segments[0] === 'auth'
    if (!signedIn && !inAuthGroup) {
      router.replace('/auth')
    } else if (signedIn && inAuthGroup) {
      router.replace('/(tabs)/chats')
    }
    if (signedIn) {
      // Fire-and-forget push registration; failures are swallowed inside.
      registerForPushNotifications().catch(() => {})
    }
  }, [ready, signedIn, segments, router])

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.ink} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Slot />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
})
