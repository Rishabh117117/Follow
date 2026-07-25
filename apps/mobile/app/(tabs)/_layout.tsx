import { useEffect, useState } from 'react'
import { Tabs } from 'expo-router'
import { Text, View, StyleSheet, AppState } from 'react-native'
import { colors, fontSize } from '@/theme/colors'
import { getUnreadCount } from '@/lib/workspace-api'

type IconProps = { focused: boolean; glyph: string }

function TabIcon({ focused, glyph }: IconProps) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.icon, focused && styles.iconFocused]}>{glyph}</Text>
    </View>
  )
}

/** Polls the unread-count endpoint every 30s while the app is foregrounded. */
function useUnreadCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setInterval> | null = null

    async function refresh() {
      try {
        const data = await getUnreadCount()
        if (active) setCount(data.count ?? 0)
      } catch {
        // Ignore — backend may be unreachable.
      }
    }

    function start() {
      refresh()
      timer = setInterval(refresh, 30_000)
    }
    function stop() {
      if (timer) clearInterval(timer)
      timer = null
    }

    start()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start()
      else stop()
    })

    return () => {
      active = false
      stop()
      sub.remove()
    }
  }, [])

  return count
}

export default function TabsLayout() {
  const unreadCount = useUnreadCount()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.n400,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="💬" />,
        }}
      />
      <Tabs.Screen
        name="workspace"
        options={{
          title: 'Workspace',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="📄" />,
        }}
      />
      <Tabs.Screen
        name="notebooks"
        options={{
          title: 'Notebooks',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="📓" />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="👤" />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    height: 80,
    paddingTop: 8,
    paddingBottom: 20,
    borderTopColor: colors.n200,
    backgroundColor: colors.paper,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22, opacity: 0.55 },
  iconFocused: { opacity: 1 },
  badge: {
    backgroundColor: colors.ink,
    color: colors.paper,
    fontSize: 10,
  },
})
