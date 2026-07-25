import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'
import { Avatar } from '@/components/Avatar'
import { apiRequest } from '@/lib/api'
import { createConversation } from '@/lib/chat-api'
import { getWorkspaceId } from '@/lib/auth'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

type Member = {
  userId: string
  name: string
  email: string
  avatarUrl?: string | null
  role: string
}

export default function NewGroupScreen() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const workspaceId = await getWorkspaceId()
      if (!workspaceId) return
      const data = await apiRequest<Member[]>(
        `/api/workspaces/${workspaceId}/members`,
      )
      setMembers(data)
    } catch {
      // Fallback empty list — UI still lets users create a solo group.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = members.filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.email.toLowerCase().includes(query.toLowerCase()),
  )

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function onCreate() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a group name.')
      return
    }
    if (selected.size === 0) {
      Alert.alert('No members', 'Add at least one member to the group.')
      return
    }
    setCreating(true)
    try {
      const workspaceId = await getWorkspaceId()
      if (!workspaceId) return
      const conv = await createConversation({
        workspaceId,
        type: 'group',
        title: name.trim(),
        memberIds: Array.from(selected),
      })
      router.replace({ pathname: '/chat/[id]', params: { id: conv.id } })
    } catch (err) {
      Alert.alert(
        'Could not create group',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New Group</Text>
        <Pressable onPress={onCreate} disabled={creating}>
          <Text style={[styles.create, creating && { opacity: 0.5 }]}>
            {creating ? '…' : 'Create'}
          </Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.nameInput}
        placeholder="Group name"
        placeholderTextColor={colors.n400}
        value={name}
        onChangeText={setName}
      />

      <TextInput
        style={styles.searchInput}
        placeholder="Search workspace members"
        placeholderTextColor={colors.n400}
        value={query}
        onChangeText={setQuery}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={{ paddingHorizontal: spacing.lg }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.userId)
            return (
              <Pressable
                style={styles.memberRow}
                onPress={() => toggle(item.userId)}
              >
                <Avatar name={item.name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <Text style={styles.memberEmail}>{item.email}</Text>
                </View>
                <View
                  style={[
                    styles.check,
                    isSelected && styles.checkSelected,
                  ]}
                >
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>No workspace members found.</Text>
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  cancel: { fontSize: fontSize.md, color: colors.n500 },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.n900 },
  create: { fontSize: fontSize.md, color: colors.accent, fontWeight: '700' },
  nameInput: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.n900,
    borderBottomWidth: 1,
    borderBottomColor: colors.n200,
  },
  searchInput: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.n100,
    borderRadius: radius.md,
    fontSize: fontSize.md,
    color: colors.n900,
  },
  sep: { height: 1, backgroundColor: colors.n100 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  memberName: { fontSize: fontSize.md, color: colors.n900, fontWeight: '600' },
  memberEmail: { fontSize: fontSize.xs, color: colors.n500 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.n300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  checkMark: { color: colors.paper, fontSize: 14, fontWeight: '700' },
  empty: {
    textAlign: 'center',
    color: colors.n500,
    fontSize: fontSize.sm,
    padding: spacing.xl,
  },
})
