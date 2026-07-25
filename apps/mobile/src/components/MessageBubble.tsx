import { View, Text, StyleSheet } from 'react-native'
import { Avatar } from './Avatar'
import { colors, radius, spacing, fontSize } from '../theme/colors'

export type BubbleRole = 'user' | 'assistant' | 'system' | 'tool'

export type MessageBubbleProps = {
  role: BubbleRole
  content: string
  senderName?: string
  showAvatar?: boolean
  streaming?: boolean
  showTimestamp?: string
}

export function MessageBubble({
  role,
  content,
  senderName,
  showAvatar = true,
  streaming,
  showTimestamp,
}: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <View style={styles.wrapper}>
      {showTimestamp && <Text style={styles.timestamp}>{showTimestamp}</Text>}
      <View style={[styles.row, isUser ? styles.rowEnd : styles.rowStart]}>
        {!isUser && showAvatar && (
          <Avatar name={senderName ?? 'Follow'} size={28} />
        )}
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
          ]}
        >
          {!isUser && senderName && senderName !== 'Follow' && (
            <Text style={styles.sender}>{senderName}</Text>
          )}
          <Text style={[styles.text, isUser ? styles.textUser : styles.textAssistant]}>
            {content}
            {streaming && <Text style={styles.cursor}>▍</Text>}
          </Text>
        </View>
      </View>
    </View>
  )
}

export function ToolCallBar({ tool }: { tool: string }) {
  const label = TOOL_LABELS[tool] ?? `Using ${tool}…`
  return (
    <View style={styles.toolCall}>
      <Text style={styles.toolCallText}>{label}</Text>
    </View>
  )
}

const TOOL_LABELS: Record<string, string> = {
  search_files: '🔍 Searching files…',
  read_document: '📄 Reading document…',
  web_search: '🌐 Searching the web…',
  read_notebook: '📓 Reading notebook…',
  screenshot_analyze: '🖼️ Analyzing screenshot…',
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg, paddingVertical: 2 },
  timestamp: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.n400,
    marginVertical: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
  },
  bubbleUser: {
    backgroundColor: colors.ink,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.n100,
    borderBottomLeftRadius: 4,
  },
  sender: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.n500,
    marginBottom: 2,
  },
  text: { fontSize: fontSize.md, lineHeight: 20 },
  textUser: { color: colors.paper },
  textAssistant: { color: colors.n900 },
  cursor: { color: colors.n400, fontWeight: '700' },
  toolCall: {
    paddingHorizontal: spacing.lg + 32,
    paddingVertical: spacing.xs,
  },
  toolCallText: {
    fontSize: fontSize.xs,
    color: colors.n500,
    fontStyle: 'italic',
  },
})
