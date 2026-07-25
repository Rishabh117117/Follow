import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, fontSize } from '../theme/colors'

export type ChatType = 'chat' | 'doc' | 'group' | 'project'

const LABEL: Record<ChatType, string> = {
  chat: 'Chat',
  doc: 'Doc',
  group: 'Group',
  project: 'Project',
}

const BG: Record<ChatType, string> = {
  chat: colors.n200,
  doc: '#DBEAFE',
  group: '#DCFCE7',
  project: '#FEF3C7',
}

const FG: Record<ChatType, string> = {
  chat: colors.n700,
  doc: '#1E40AF',
  group: '#166534',
  project: '#92400E',
}

export function ChatTypeBadge({ type }: { type: ChatType }) {
  return (
    <View style={[styles.badge, { backgroundColor: BG[type] }]}>
      <Text style={[styles.text, { color: FG[type] }]}>{LABEL[type]}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
})
