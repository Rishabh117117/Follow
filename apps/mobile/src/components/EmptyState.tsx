import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, fontSize, spacing, radius } from '../theme/colors'

export type EmptyStateProps = {
  icon?: string
  title: string
  message?: string
  ctaLabel?: string
  onCtaPress?: () => void
}

export function EmptyState({
  icon = '✨',
  title,
  message,
  ctaLabel,
  onCtaPress,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {ctaLabel && onCtaPress && (
        <Pressable style={styles.cta} onPress={onCtaPress}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  icon: { fontSize: 44, marginBottom: spacing.md },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.n900,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.sm,
    color: colors.n500,
    textAlign: 'center',
    maxWidth: 260,
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  ctaText: {
    color: colors.paper,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
