import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { apiRequest } from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowAlert: true,
  }),
})

/**
 * Requests permission, fetches the Expo push token, and posts it to the backend
 * so the server can deliver notifications to this device. Safe to call every
 * app launch — the backend is expected to upsert by token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (existing !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync()
    status = requested
  }
  if (status !== 'granted') return null

  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ?? undefined

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    const token = tokenData.data
    try {
      await apiRequest('/api/users/me/push-token', {
        method: 'POST',
        body: { token, platform: Platform.OS },
      })
    } catch {
      // Backend endpoint may not exist yet in dev — swallow to keep the app usable.
    }
    return token
  } catch {
    return null
  }
}
