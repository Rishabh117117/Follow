import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { EmptyState } from '@/components/EmptyState'
import { listFiles, type FileRow } from '@/lib/workspace-api'
import { getWorkspaceId } from '@/lib/auth'
import { colors, spacing, fontSize } from '@/theme/colors'

const NOTEBOOK_MIME = 'application/vnd.workspace.notebook'

function formatEdited(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotebooksScreen() {
  const [notebooks, setNotebooks] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    const workspaceId = await getWorkspaceId()
    if (!workspaceId) {
      setLoading(false)
      return
    }
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const files = await listFiles({ workspaceId, mimeType: NOTEBOOK_MIME })
      setNotebooks(files.filter((f) => f.type === 'file'))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notebooks</Text>
        <Pressable style={styles.plus} accessibilityLabel="New notebook">
          <Text style={styles.plusText}>+</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : error ? (
        <EmptyState
          icon="⚠️"
          title="Couldn't load notebooks"
          message={error}
          ctaLabel="Retry"
          onCtaPress={() => load()}
        />
      ) : notebooks.length === 0 ? (
        <EmptyState
          icon="📓"
          title="No notebooks yet"
          message="Notebook editing is available on desktop and tablet."
        />
      ) : (
        <FlatList
          data={notebooks}
          keyExtractor={(n) => n.id}
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
            <Pressable style={styles.row}>
              <Text style={styles.icon}>📓</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title2}>{item.name}</Text>
                <Text style={styles.meta}>{formatEdited(item.updatedAt)}</Text>
              </View>
            </Pressable>
          )}
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
  plusText: { color: colors.paper, fontSize: 22, lineHeight: 24, marginTop: -2 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sep: { height: 1, backgroundColor: colors.n100 },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  icon: { fontSize: 24 },
  title2: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.n900,
    marginBottom: 2,
  },
  meta: { fontSize: fontSize.xs, color: colors.n500 },
})
