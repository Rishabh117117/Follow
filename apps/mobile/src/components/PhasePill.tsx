import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, fontSize } from '../theme/colors'

export type Phase =
  | 'inception'
  | 'exploration'
  | 'convergence'
  | 'stabilization'
  | 'delivery'

const LABEL: Record<Phase, string> = {
  inception: 'Inception',
  exploration: 'Exploration',
  convergence: 'Convergence',
  stabilization: 'Stabilization',
  delivery: 'Delivery',
}

export function PhasePill({ phase }: { phase: Phase }) {
  const bg = colors.phase[phase]
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={styles.text}>{LABEL[phase]}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    color: colors.paper,
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
})
