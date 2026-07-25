import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'
import { apiRequest } from '@/lib/api'
import { createConversation } from '@/lib/chat-api'
import { getWorkspaceId } from '@/lib/auth'
import { colors, spacing, radius, fontSize } from '@/theme/colors'

type FileRow = {
  id: string
  name: string
  type: 'file' | 'folder'
  updatedAt: string
  workspaceId: string
}

export default function NewDocChatScreen() {
  const router = useRouter()
  const [files, setFiles] = useState<FileRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const workspaceId = await getWorkspaceId()
      if (!workspaceId) return
      const data = await apiRequest<FileRow[]>(
        `/api/files?workspaceId=${workspaceId}&type=file`,
      )
      setFiles(data.filter((f) => f.type === 'file'))
    } catch (err) {
      Alert.alert(
        'Could not load documents',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function onSelect(file: FileRow) {
    setCreating(file.id)
    try {
      const conv = await createConversation({
        workspaceId: file.workspaceId,
        type: 'standard',
        title: file.name,
        contextObjectId: file.id,
        contextObjectType: 'document',
      })
      router.replace({ pathname: '/chat/[id]', params: { id: conv.id } })
    } catch (err) {
      Alert.alert(
        'Could not create chat',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setCreating(null)
    }
  }

  const filtered = files.filter(
    (f) => !query || f.name.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Choose a document</Text>
        <View style={{ width: 60 }} />
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search documents"
        placeholderTextColor={colors.n400}
        value={query}
        onChangeText={setQuery}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => onSelect(item)}
              disabled={creating === item.id}
            >
              <Text style={styles.icon}>📄</Text>
              <Text style={styles.name}>{item.name}</Text>
              {creating === item.id && (
                <ActivityIndicator color={colors.n500} size="small" />
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No documents in this workspace.</Text>
          }
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
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.n100,
  },
  cancel: { fontSize: fontSize.md, color: colors.n500, width: 60 },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.n900 },
  search: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.n100,
    borderRadius: radius.md,
    fontSize: fontSize.md,
    color: colors.n900,
  },
  sep: { height: 1, backgroundColor: colors.n100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  icon: { fontSize: 22 },
  name: { flex: 1, fontSize: fontSize.md, color: colors.n900 },
  empty: {
    textAlign: 'center',
    color: colors.n500,
    fontSize: fontSize.sm,
    padding: spacing.xl,
  },
})
