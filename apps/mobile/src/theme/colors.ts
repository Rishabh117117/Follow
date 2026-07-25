// Follow mobile theme. Mirrors CSS vars used on web (--n50..n900, accents).
export const colors = {
  n50: '#FAFAFA',
  n100: '#F4F4F5',
  n200: '#E4E4E7',
  n300: '#D4D4D8',
  n400: '#A1A1AA',
  n500: '#71717A',
  n600: '#52525B',
  n700: '#3F3F46',
  n800: '#27272A',
  n900: '#18181B',
  ink: '#0A0A0A',
  paper: '#FFFFFF',
  accent: '#4F46E5', // indigo — AI/ghost draft accent
  amber: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  // Phase colors (Inception → Delivery)
  phase: {
    inception: '#A1A1AA',
    exploration: '#4F46E5',
    convergence: '#F59E0B',
    stabilization: '#10B981',
    delivery: '#0A0A0A',
  },
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  display: 34,
} as const
