import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { AvatarStack } from '@/components/AvatarStack'
import { ChatTypeBadge, type ChatType } from '@/components/ChatTypeBadge'
import { EmptyState } from '@/components/EmptyState'
import {
  listConversations,
  createConversation,
  uiTypeFor,
  type Conversation,
  type UiChatType,
} from '@/lib/chat-api'
import { getWorkspaceId } from '@/lib/auth'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

const FILTERS = ['All', 'Documents', 'Groups', 'Projects'] as const
type Filter = (typeof FILTERS)[number]

const FILTER_TO_TYPE: Record<Filter, UiChatType | null> = {
  All: null,
  Documents: 'doc',
  Groups: 'group',
  Projects: 'project',
}

function formatTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (diff < 60_000) return 'now'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}h`
  const days = Math.floor(diff / 86_400_000)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString()
}

export default function ChatsScreen() {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    const workspaceId = await getWorkspaceId()
    if (!workspaceId) {
      setError('No workspace')
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await listConversations({
        workspaceId,
        status: 'active',
        signal: ctrl.signal,
      })
      setConversations(data)
      setError(null)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to load')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  const typeFilter = FILTER_TO_TYPE[filter]
  const filtered = conversations.filter((c) => {
    const ui = uiTypeFor(c)
    if (typeFilter && ui !== typeFilter) return false
    const title = c.title ?? ''
    if (query && !title.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  async function onNewChat() {
    const options = ['New Chat', 'New Group Chat', 'New Document Chat', 'Cancel']
    const handleSelection = async (index: number) => {
      if (index === 0) {
        try {
          const workspaceId = await getWorkspaceId()
          if (!workspaceId) return
          const conv = await createConversation({
            workspaceId,
            type: 'standard',
            title: 'New chat',
          })
          router.push({ pathname: '/chat/[id]', params: { id: conv.id } })
        } catch (err) {
          Alert.alert(
            'Could not create chat',
            err instanceof Error ? err.message : 'Unknown error',
          )
        }
      } else if (index === 1) {
        router.push('/chat/new-group')
      } else if (index === 2) {
        router.push('/chat/new-doc')
      }
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3 },
        handleSelection,
      )
    } else {
      Alert.alert('New…', undefined, [
        { text: options[0]!, onPress: () => handleSelection(0) },
        { text: options[1]!, onPress: () => handleSelection(1) },
        { text: options[2]!, onPress: () => handleSelection(2) },
        { text: options[3]!, style: 'cancel' },
      ])
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <Pressable
          style={styles.plus}
          accessibilityLabel="New chat"
          onPress={onNewChat}
        >
          <Text style={styles.plusText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search chats"
          placeholderTextColor={colors.n400}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text
                style={[styles.filterText, active && styles.filterTextActive]}
              >
                {f}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {loading && conversations.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : error && conversations.length === 0 ? (
        <EmptyState
          icon="⚠️"
          title="Couldn't load chats"
          message={error}
          ctaLabel="Retry"
          onCtaPress={() => load()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="💬"
          title="No conversations yet"
          message="Tap + to start a new chat."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.n500}
            />
          }
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              onPress={() =>
                router.push({ pathname: '/chat/[id]', params: { id: item.id } })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  )
}

function ConversationRow({
  item,
  onPress,
}: {
  item: Conversation
  onPress: () => void
}) {
  const ui = uiTypeFor(item)
  const badgeType: ChatType = ui
  const title = item.title ?? 'Untitled'
  const preview = item.lastMessage?.content ?? 'No messages yet'
  const time = formatTime(item.lastMessage?.createdAt ?? item.updatedAt)
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <AvatarStack names={[title]} size={40} max={2} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowTime}>{time}</Text>
        </View>
        <View style={styles.rowMeta}>
          <ChatTypeBadge type={badgeType} />
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
      </View>
    </Pressable>
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
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: 'serif',
    fontSize: fontSize.display,
    color: colors.ink,
  },
  plus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: {
    color: colors.paper,
    fontSize: 22,
    lineHeight: 24,
    marginTop: -2,
  },
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  search: {
    backgroundColor: colors.n100,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.md,
    color: colors.n900,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.n100,
  },
  filterPillActive: { backgroundColor: colors.ink },
  filterText: { fontSize: fontSize.sm, color: colors.n600, fontWeight: '600' },
  filterTextActive: { color: colors.paper },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sep: { height: 1, backgroundColor: colors.n100 },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.n900,
  },
  rowTime: {
    fontSize: fontSize.xs,
    color: colors.n400,
    marginLeft: spacing.sm,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  rowPreview: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.n500,
  },
})
