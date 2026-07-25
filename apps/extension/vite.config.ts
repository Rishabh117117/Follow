import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Unified Extension Vite Config
 *
 * Builds each entry as a self-contained IIFE bundle.
 * Feature modules are built separately for lazy loading via dynamic import.
 */
export default defineConfig(({ mode }) => {
  const entry = process.env.BUILD_ENTRY || 'detector'

  const entries: Record<string, { input: string; outDir: string; fileName?: string; format?: 'iife' | 'es' }> = {
    // Core entry points — IIFE (self-contained)
    detector: {
      input: resolve(__dirname, 'src/content/detector.ts'),
      outDir: 'dist/content',
      fileName: 'detector.js',
    },
    'early-capture': {
      input: resolve(__dirname, 'src/content/early-capture.ts'),
      outDir: 'dist/content',
      fileName: 'early-capture.js',
    },
    background: {
      input: resolve(__dirname, 'src/background/service-worker.ts'),
      outDir: 'dist/background',
      fileName: 'service-worker.js',
    },
    popup: {
      input: resolve(__dirname, 'popup/popup.tsx'),
      outDir: 'dist/popup',
      fileName: 'popup.js',
    },
    // Feature modules — IIFE (injected via chrome.scripting.executeScript)
    'feature-gws-tracking': {
      input: resolve(__dirname, 'src/features/gws-tracking/index.ts'),
      outDir: 'dist/features',
      fileName: 'gws-tracking.js',
    },
    'feature-web-tracking': {
      input: resolve(__dirname, 'src/features/web-tracking/index.ts'),
      outDir: 'dist/features',
      fileName: 'web-tracking.js',
    },
    'feature-chat': {
      input: resolve(__dirname, 'src/features/chat/index.ts'),
      outDir: 'dist/features',
      fileName: 'chat.js',
    },
    'feature-doc-intel': {
      input: resolve(__dirname, 'src/features/doc-intel/index.ts'),
      outDir: 'dist/features',
      fileName: 'doc-intel.js',
    },
    'feature-ai-writing': {
      input: resolve(__dirname, 'src/features/ai-writing/index.ts'),
      outDir: 'dist/features',
      fileName: 'ai-writing.js',
    },
    'feature-smart-doc': {
      input: resolve(__dirname, 'src/features/smart-doc/index.ts'),
      outDir: 'dist/features',
      fileName: 'smart-doc.js',
    },
  }

  const current = entries[entry]
  if (!current) {
    throw new Error(`Unknown BUILD_ENTRY: ${entry}. Available: ${Object.keys(entries).join(', ')}`)
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: current.outDir,
      emptyOutDir: false,
      lib: {
        entry: current.input,
        formats: ['iife'],
        name: `Follow_${entry.replace(/[-/]/g, '_')}`,
        fileName: () => current.fileName || `${entry}.js`,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      cssCodeSplit: false,
      target: 'es2022',
      minify: mode === 'production',
      sourcemap: mode === 'development' ? 'inline' : false,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode || 'development'),
    },
  }
})
