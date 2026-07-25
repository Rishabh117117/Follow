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
import { useRouter } from 'expo-router'
import { PhasePill, type Phase } from '@/components/PhasePill'
import { EmptyState } from '@/components/EmptyState'
import {
  listFiles,
  listSpaces,
  type FileRow,
  type SpaceRow,
} from '@/lib/workspace-api'
import { getWorkspaceId } from '@/lib/auth'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

const SEGMENTS = ['Documents', 'Projects'] as const
type Segment = (typeof SEGMENTS)[number]

function formatEdited(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

function phaseFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): Phase {
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

function tensionsFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): number {
  const t = meta?.tensions
  if (typeof t === 'number') return t
  if (Array.isArray(t)) return t.length
  return 0
}

export default function WorkspaceScreen() {
  const router = useRouter()
  const [segment, setSegment] = useState<Segment>('Documents')
  const [docs, setDocs] = useState<FileRow[]>([])
  const [projects, setProjects] = useState<SpaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    const workspaceId = await getWorkspaceId()
    if (!workspaceId) {
      setError('No workspace')
      setLoading(false)
      return
    }
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const [filesData, spacesData] = await Promise.all([
        listFiles({ workspaceId }),
        listSpaces(workspaceId),
      ])
      setDocs(filesData.filter((f) => f.type === 'file'))
      setProjects(spacesData)
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
        <Text style={styles.title}>Workspace</Text>
      </View>

      <View style={styles.segment}>
        {SEGMENTS.map((s) => {
          const active = segment === s
          return (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              style={[styles.segmentItem, active && styles.segmentActive]}
            >
              <Text
                style={[styles.segmentText, active && styles.segmentTextActive]}
              >
                {s}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : error ? (
        <EmptyState
          icon="⚠️"
          title="Couldn't load workspace"
          message={error}
          ctaLabel="Retry"
          onCtaPress={() => load()}
        />
      ) : segment === 'Documents' ? (
        <DocumentsList
          docs={docs}
          refreshing={refreshing}
          onRefresh={() => load(true)}
          onOpen={(id) =>
            router.push({ pathname: '/document/[id]', params: { id } })
          }
        />
      ) : (
        <ProjectsList
          projects={projects}
          refreshing={refreshing}
          onRefresh={() => load(true)}
        />
      )}
    </SafeAreaView>
  )
}

function DocumentsList({
  docs,
  refreshing,
  onRefresh,
  onOpen,
}: {
  docs: FileRow[]
  refreshing: boolean
  onRefresh: () => void
  onOpen: (id: string) => void
}) {
  if (docs.length === 0) {
    return (
      <EmptyState
        icon="📄"
        title="No documents"
        message="Documents you create in Follow will appear here."
      />
    )
  }
  return (
    <FlatList
      data={docs}
      keyExtractor={(d) => d.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.n500}
        />
      }
      renderItem={({ item }) => (
        <Pressable style={styles.docRow} onPress={() => onOpen(item.id)}>
          <Text style={styles.docIcon}>📄</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.docTitle}>{item.name}</Text>
            <View style={styles.docMeta}>
              <PhasePill phase={phaseFromMetadata(item.metadata)} />
              <Text style={styles.docMetaText}>
                {formatEdited(item.updatedAt)}
              </Text>
              {tensionsFromMetadata(item.metadata) > 0 && (
                <Text style={[styles.docMetaText, styles.tension]}>
                  · {tensionsFromMetadata(item.metadata)} tensions
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      )}
    />
  )
}

function ProjectsList({
  projects,
  refreshing,
  onRefresh,
}: {
  projects: SpaceRow[]
  refreshing: boolean
  onRefresh: () => void
}) {
  if (projects.length === 0) {
    return (
      <EmptyState
        icon="📁"
        title="No projects"
        message="Group related documents into projects to keep your workspace organized."
      />
    )
  }
  return (
    <FlatList
      data={projects}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.n500}
        />
      }
      renderItem={({ item }) => (
        <Pressable style={styles.projectCard}>
          <View
            style={[
              styles.projectDot,
              { backgroundColor: item.color ?? colors.accent },
            ]}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.projectName}>{item.name}</Text>
            {item.description && (
              <Text style={styles.projectMeta} numberOfLines={1}>
                {item.description}
              </Text>
            )}
          </View>
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: 'serif',
    fontSize: fontSize.display,
    color: colors.ink,
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.n100,
    borderRadius: radius.md,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.paper,
    elevation: 1,
    shadowOpacity: 0.08,
  },
  segmentText: { fontSize: fontSize.sm, color: colors.n500, fontWeight: '600' },
  segmentTextActive: { color: colors.n900 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sep: { height: 1, backgroundColor: colors.n100 },
  docRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  docIcon: { fontSize: 24 },
  docTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.n900,
    marginBottom: 4,
  },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  docMetaText: { fontSize: fontSize.xs, color: colors.n500 },
  tension: { color: colors.amber, fontWeight: '600' },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.n200,
  },
  projectDot: { width: 12, height: 12, borderRadius: 6 },
  projectName: { fontSize: fontSize.md, fontWeight: '600', color: colors.n900 },
  projectMeta: { fontSize: fontSize.xs, color: colors.n500, marginTop: 2 },
})
