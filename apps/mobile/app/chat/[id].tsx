import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { AvatarStack } from '@/components/AvatarStack'
import { MessageBubble, ToolCallBar } from '@/components/MessageBubble'
import { ChatTypeBadge } from '@/components/ChatTypeBadge'
import {
  getConversation,
  sendMessage,
  uiTypeFor,
  type Message,
  type Conversation,
} from '@/lib/chat-api'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

type DisplayMessage = Message & { streaming?: boolean }

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentTool, setCurrentTool] = useState<string | null>(null)
  const sendAbort = useRef<AbortController | null>(null)
  const listRef = useRef<FlatList<DisplayMessage>>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await getConversation(id)
      const { messages: msgs, ...conv } = data
      setConversation(conv)
      setMessages(msgs)
    } catch (err) {
      Alert.alert(
        'Could not load chat',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => () => sendAbort.current?.abort(), [])

  async function onSend() {
    const trimmed = input.trim()
    if (!trimmed || !id || sending) return
    setInput('')
    setSending(true)
    setCurrentTool(null)

    const now = new Date().toISOString()
    const tempUser: DisplayMessage = {
      id: `temp-user-${Date.now()}`,
      conversationId: id,
      userId: 'me',
      role: 'user',
      content: trimmed,
      createdAt: now,
    }
    const tempAssistant: DisplayMessage = {
      id: `temp-assistant-${Date.now()}`,
      conversationId: id,
      userId: null,
      role: 'assistant',
      content: '',
      createdAt: now,
      streaming: true,
    }
    setMessages((m) => [...m, tempUser, tempAssistant])

    const ctrl = new AbortController()
    sendAbort.current = ctrl

    try {
      await sendMessage({
        conversationId: id,
        content: trimmed,
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'token') {
            setMessages((prev) => {
              const copy = prev.slice()
              const last = copy[copy.length - 1]
              if (last && last.streaming) {
                copy[copy.length - 1] = { ...last, content: last.content + e.content }
              }
              return copy
            })
          } else if (e.type === 'tool_start') {
            setCurrentTool(e.tool)
          } else if (e.type === 'tool_end') {
            setCurrentTool(null)
          } else if (e.type === 'done') {
            setMessages((prev) => {
              const copy = prev.slice()
              const last = copy[copy.length - 1]
              if (last && last.streaming) {
                copy[copy.length - 1] = { ...last, streaming: false }
              }
              return copy
            })
          } else if (e.type === 'error') {
            Alert.alert('AI error', e.message)
          }
        },
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        Alert.alert(
          'Send failed',
          err instanceof Error ? err.message : 'Unknown error',
        )
      }
    } finally {
      setSending(false)
      setCurrentTool(null)
      setMessages((prev) => {
        const copy = prev.slice()
        const last = copy[copy.length - 1]
        if (last && last.streaming) {
          copy[copy.length - 1] = { ...last, streaming: false }
        }
        return copy
      })
      // Reload from server to get canonical message ids.
      setTimeout(load, 300)
    }
  }

  const title = conversation?.title ?? 'Chat'
  const badgeType = conversation
    ? uiTypeFor(conversation)
    : ('chat' as const)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <AvatarStack names={[title]} size={28} max={2} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <ChatTypeBadge type={badgeType} />
      </View>

      {conversation?.contextObjectType === 'document' && (
        <View style={styles.followingBar}>
          <Text style={styles.followingText}>
            📄 {(conversation.metadata as { docName?: string })?.docName ?? 'Document'}
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ paddingVertical: spacing.md }}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: true })
            }
            renderItem={({ item, index }) => {
              const prev = messages[index - 1]
              const showTs = shouldShowTimestamp(prev?.createdAt, item.createdAt)
              return (
                <MessageBubble
                  role={item.role}
                  content={item.content}
                  streaming={item.streaming}
                  showTimestamp={
                    showTs ? formatTimestamp(item.createdAt) : undefined
                  }
                />
              )
            }}
            ListFooterComponent={
              currentTool ? <ToolCallBar tool={currentTool} /> : null
            }
          />
        )}

        <View style={styles.inputBar}>
          <Pressable style={styles.attach}>
            <Text style={styles.attachText}>+</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={colors.n400}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={5000}
          />
          <Pressable
            style={[styles.send, !input.trim() && styles.sendDisabled]}
            onPress={onSend}
            disabled={!input.trim() || sending}
            accessibilityLabel="Send message"
          >
            {sending ? (
              <ActivityIndicator color={colors.paper} size="small" />
            ) : (
              <Text style={styles.sendText}>↑</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function shouldShowTimestamp(prevIso: string | undefined, nowIso: string): boolean {
  if (!prevIso) return true
  const diff = new Date(nowIso).getTime() - new Date(prevIso).getTime()
  return diff > 5 * 60_000
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 32,
    color: colors.ink,
    lineHeight: 32,
    marginTop: -4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.n900,
    flex: 1,
  },
  followingBar: {
    backgroundColor: colors.n50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  followingText: { fontSize: fontSize.xs, color: colors.n600 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.n100,
    backgroundColor: colors.paper,
  },
  attach: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.n100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachText: { fontSize: 22, color: colors.n500, marginTop: -2 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 36,
    backgroundColor: colors.n100,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: fontSize.md,
    color: colors.n900,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.n300 },
  sendText: {
    color: colors.paper,
    fontSize: 20,
    fontWeight: '700',
    marginTop: -2,
  },
})
