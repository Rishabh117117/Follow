import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Avatar } from '@/components/Avatar'
import { clearSession, getWorkspaceId } from '@/lib/auth'
import { getMe, getAiState, type MeResponse } from '@/lib/workspace-api'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

type WorkPattern = { label: string; value: string }
type Fact = { id: string; fact: string; confidence: 'high' | 'medium' | 'low' }

const CONFIDENCE_COLOR = {
  high: colors.green,
  medium: colors.amber,
  low: colors.red,
} as const

function extractPatterns(persistent: Record<string, unknown>): WorkPattern[] {
  const wp = (persistent.workPatterns ?? {}) as Record<string, unknown>
  const out: WorkPattern[] = []
  if (wp.peakHours) out.push({ label: 'Peak hours', value: String(wp.peakHours) })
  if (wp.workStyle) out.push({ label: 'Work style', value: String(wp.workStyle) })
  if (wp.aiAcceptanceRate != null) {
    const rate = Number(wp.aiAcceptanceRate)
    out.push({
      label: 'AI acceptance',
      value: rate > 1 ? `${rate.toFixed(0)}%` : `${(rate * 100).toFixed(0)}%`,
    })
  }
  if (wp.avgSessionMinutes != null) {
    out.push({ label: 'Avg session', value: `${wp.avgSessionMinutes} minutes` })
  }
  if (wp.collabStyle) {
    out.push({ label: 'Collab style', value: String(wp.collabStyle) })
  }
  return out
}

function extractFacts(persistent: Record<string, unknown>): Fact[] {
  const raw = (persistent.longTermKnowledge ?? []) as unknown[]
  return raw.slice(0, 10).map((item, i) => {
    const obj = item as Record<string, unknown>
    const confidenceNum = Number(obj.confidence)
    let confidence: Fact['confidence'] = 'medium'
    if (!Number.isNaN(confidenceNum)) {
      if (confidenceNum >= 0.75) confidence = 'high'
      else if (confidenceNum >= 0.4) confidence = 'medium'
      else confidence = 'low'
    } else if (
      obj.confidence === 'high' ||
      obj.confidence === 'medium' ||
      obj.confidence === 'low'
    ) {
      confidence = obj.confidence
    }
    return {
      id: String(obj.id ?? i),
      fact: String(obj.fact ?? obj.content ?? ''),
      confidence,
    }
  })
}

export default function YouScreen() {
  const router = useRouter()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [patterns, setPatterns] = useState<WorkPattern[]>([])
  const [facts, setFacts] = useState<Fact[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const workspaceId = await getWorkspaceId()
      const [meData, stateData] = await Promise.all([
        getMe(),
        workspaceId
          ? getAiState(workspaceId).catch(() => ({ statePersistent: {} }))
          : Promise.resolve({ statePersistent: {} }),
      ])
      setMe(meData)
      const persistent =
        (stateData.statePersistent ?? meData.statePersistent ?? {}) as Record<
          string,
          unknown
        >
      setPatterns(extractPatterns(persistent))
      setFacts(extractFacts(persistent))
    } catch {
      // Still allow render with defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function onSignOut() {
    Alert.alert('Sign out', 'Sign out of Follow?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await clearSession()
          router.replace('/auth')
        },
      },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </SafeAreaView>
    )
  }

  const userName = me?.user.name ?? 'You'
  const userEmail = me?.user.email ?? ''

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileCard}>
          <Avatar name={userName} size={64} />
          <Text style={styles.name}>{userName}</Text>
          <Text style={styles.email}>{userEmail}</Text>
        </View>

        <Section
          title="Work Patterns"
          footer={
            patterns.length > 0
              ? 'Learned from your activity · Updated hourly'
              : undefined
          }
        >
          {patterns.length === 0 ? (
            <Text style={styles.emptyText}>
              Follow hasn&apos;t learned your patterns yet.
            </Text>
          ) : (
            patterns.map((p) => (
              <View key={p.label} style={styles.patternRow}>
                <Text style={styles.patternLabel}>{p.label}</Text>
                <Text style={styles.patternValue}>{p.value}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Follow's Memory" actionLabel="Manage →">
          {facts.length === 0 ? (
            <Text style={styles.emptyText}>
              Follow hasn&apos;t remembered anything about you yet.
            </Text>
          ) : (
            facts.map((f) => (
              <View key={f.id} style={styles.factRow}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: CONFIDENCE_COLOR[f.confidence] },
                  ]}
                />
                <Text style={styles.factText}>{f.fact}</Text>
              </View>
            ))
          )}
        </Section>

        <View style={styles.settings}>
          <SettingLink label="Settings" />
          <SettingLink label="AI Preferences" />
          <SettingLink label="Connected Accounts" />
          <SettingLink label="Help & Feedback" />
          <SettingLink label="Sign Out" destructive onPress={onSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({
  title,
  footer,
  actionLabel,
  children,
}: {
  title: string
  footer?: string
  actionLabel?: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {actionLabel && (
          <Pressable>
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.sectionBody}>{children}</View>
      {footer && <Text style={styles.sectionFooter}>{footer}</Text>}
    </View>
  )
}

function SettingLink({
  label,
  destructive,
  onPress,
}: {
  label: string
  destructive?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable style={styles.settingRow} onPress={onPress}>
      <Text
        style={[styles.settingLabel, destructive && { color: colors.red }]}
      >
        {label}
      </Text>
      <Text style={styles.settingChevron}>›</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: spacing.xxl },
  profileCard: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  name: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.n900,
    marginTop: spacing.sm,
  },
  email: { fontSize: fontSize.sm, color: colors.n500, marginTop: 2 },
  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    color: colors.n500,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  sectionAction: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  sectionBody: {
    backgroundColor: colors.n50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sectionFooter: {
    fontSize: fontSize.xs,
    color: colors.n400,
    marginTop: spacing.xs,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.n500,
    paddingVertical: spacing.sm,
    fontStyle: 'italic',
  },
  patternRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  patternLabel: { fontSize: fontSize.sm, color: colors.n500 },
  patternValue: {
    fontSize: fontSize.sm,
    color: colors.n900,
    fontWeight: '600',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  factText: { flex: 1, fontSize: fontSize.sm, color: colors.n900 },
  settings: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  settingLabel: { fontSize: fontSize.md, color: colors.n900 },
  settingChevron: { fontSize: 22, color: colors.n400 },
})
