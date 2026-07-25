import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../theme/colors'

const PALETTE = [
  '#4F46E5',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#0EA5E9',
  '#EC4899',
  '#14B8A6',
]

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]!
}

export type AvatarProps = {
  name: string
  size?: number
  online?: boolean
  bgColor?: string
}

export function Avatar({ name, size = 36, online, bgColor }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  const bg = bgColor ?? colorFor(name)
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
          },
        ]}
      >
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
      </View>
      {online && (
        <View
          style={[
            styles.onlineDot,
            { width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14 },
          ]}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: colors.paper,
    fontWeight: '600',
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.paper,
  },
})
