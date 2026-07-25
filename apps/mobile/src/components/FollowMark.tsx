import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../theme/colors'

// Follow F mark — black square with white serif F. Used on auth + splash.
export function FollowMark({ size = 64 }: { size?: number }) {
  return (
    <View
      style={[
        styles.square,
        {
          width: size,
          height: size,
          borderRadius: size * 0.18,
        },
      ]}
    >
      <Text style={[styles.f, { fontSize: size * 0.62 }]}>F</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  square: {
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  f: {
    color: colors.paper,
    fontWeight: '700',
    fontFamily: 'serif',
    lineHeight: undefined,
    marginTop: -2,
  },
})
