import { View, Text, StyleSheet } from 'react-native'
import { Avatar } from './Avatar'
import { colors } from '../theme/colors'

export type AvatarStackProps = {
  names: string[]
  size?: number
  max?: number
}

export function AvatarStack({ names, size = 32, max = 3 }: AvatarStackProps) {
  const shown = names.slice(0, max)
  const overflow = names.length - shown.length
  const overlap = size * 0.32
  return (
    <View style={styles.row}>
      {shown.map((name, i) => (
        <View
          key={`${name}-${i}`}
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            borderWidth: 2,
            borderColor: colors.paper,
            borderRadius: size,
          }}
        >
          <Avatar name={name} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.overflow,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: -overlap,
            },
          ]}
        >
          <Text style={[styles.overflowText, { fontSize: size * 0.36 }]}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  overflow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.n200,
    borderWidth: 2,
    borderColor: colors.paper,
  },
  overflowText: {
    color: colors.n700,
    fontWeight: '600',
  },
})
