import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { PhasePill, type Phase } from '@/components/PhasePill'
import { getFile, type FileRow } from '@/lib/workspace-api'
import { colors, spacing, radius, fontSize } from '@/theme/colors'
import { API_URL } from '@/lib/api'

type TipTapNode = {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
}

/**
 * Minimal read-only renderer for a TipTap JSON tree. Good enough to preview
 * a document; full editing happens on desktop web.
 */
function renderTipTap(
  node: TipTapNode | TipTapNode[] | undefined,
  key = 0,
): React.ReactNode {
  if (!node) return null
  if (Array.isArray(node)) {
    return node.map((n, i) => renderTipTap(n, i))
  }
  const children = node.content
    ? node.content.map((c, i) => renderTipTap(c, i))
    : null

  switch (node.type) {
    case 'doc':
      return <View key={key}>{children}</View>
    case 'paragraph':
      return (
        <Text key={key} style={docStyles.paragraph}>
          {children}
        </Text>
      )
    case 'heading': {
      const level = (node.attrs?.level as number | undefined) ?? 1
      const style = [
        docStyles.heading,
        level === 1 && docStyles.h1,
        level === 2 && docStyles.h2,
        level >= 3 && docStyles.h3,
      ]
      return (
        <Text key={key} style={style}>
          {children}
        </Text>
      )
    }
    case 'bulletList':
    case 'orderedList':
      return (
        <View key={key} style={docStyles.list}>
          {children}
        </View>
      )
    case 'listItem':
      return (
        <View key={key} style={docStyles.listItem}>
          <Text style={docStyles.bullet}>•</Text>
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      )
    case 'blockquote':
      return (
        <View key={key} style={docStyles.blockquote}>
          {children}
        </View>
      )
    case 'text':
      return node.text ?? ''
    default:
      return children
  }
}

function phaseFromMetadata(meta: Record<string, unknown> | null): Phase {
  const phase = (meta?.phase as string | undefined)?.toLowerCase()
  if (
    phase === 'inception' ||
    phase === 'exploration' ||
    phase === 'convergence' ||
    phase === 'stabilization' ||
    phase === 'delivery'
  ) {
    return phase
  }
  return 'exploration'
}

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [file, setFile] = useState<(FileRow & { content?: unknown }) | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const data = await getFile(id)
      setFile(data)
    } catch (err) {
      Alert.alert(
        'Could not load document',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header title="" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </SafeAreaView>
    )
  }

  if (!file) return null

  const meta = file.metadata ?? {}
  const wordCount = (meta.wordCount as number | undefined) ?? null
  const tiptap =
    (meta.content as TipTapNode | undefined) ??
    (file.content as TipTapNode | undefined) ??
    null

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title={file.name} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{file.name}</Text>

        <View style={styles.propRow}>
          <PhasePill phase={phaseFromMetadata(file.metadata)} />
          {wordCount != null && (
            <Text style={styles.propText}>{wordCount.toLocaleString()} words</Text>
          )}
          <Text style={styles.propText}>
            Updated {new Date(file.updatedAt).toLocaleDateString()}
          </Text>
        </View>

        {tiptap ? (
          <View style={styles.docBody}>{renderTipTap(tiptap)}</View>
        ) : (
          <Text style={styles.noContent}>
            This document has no cached content yet. Open it on desktop to load
            the full editor.
          </Text>
        )}

        <Pressable
          style={styles.openButton}
          onPress={() => Linking.openURL(`${API_URL}/follow/doc/${file.id}`)}
        >
          <Text style={styles.openButtonText}>Open in Follow on desktop</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: 36 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 32, color: colors.ink, lineHeight: 32, marginTop: -4 },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.n900,
    textAlign: 'center',
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: {
    fontFamily: 'serif',
    fontSize: fontSize.xxl,
    color: colors.n900,
    marginBottom: spacing.sm,
  },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
  },
  propText: { fontSize: fontSize.xs, color: colors.n500 },
  docBody: { marginTop: spacing.md },
  noContent: {
    fontSize: fontSize.sm,
    color: colors.n500,
    fontStyle: 'italic',
    padding: spacing.md,
    backgroundColor: colors.n50,
    borderRadius: radius.md,
  },
  openButton: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.n300,
    alignItems: 'center',
  },
  openButtonText: {
    fontSize: fontSize.md,
    color: colors.n700,
    fontWeight: '600',
  },
})

const docStyles = StyleSheet.create({
  paragraph: {
    fontSize: fontSize.md,
    lineHeight: 22,
    color: colors.n900,
    marginBottom: spacing.md,
  },
  heading: { fontWeight: '700', color: colors.n900, marginTop: spacing.lg, marginBottom: spacing.sm },
  h1: { fontSize: fontSize.xxl },
  h2: { fontSize: fontSize.xl },
  h3: { fontSize: fontSize.lg },
  list: { marginBottom: spacing.md, paddingLeft: spacing.sm },
  listItem: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  bullet: { color: colors.n500, fontSize: fontSize.md, lineHeight: 22 },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.n300,
    paddingLeft: spacing.md,
    marginBottom: spacing.md,
  },
})
