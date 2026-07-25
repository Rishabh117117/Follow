import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Chrome Extension Vite Config
 *
 * Content scripts and service workers must be self-contained IIFE bundles
 * (no ES module imports) since Chrome doesn't support module content scripts.
 *
 * We use a single build with inlineDynamicImports to bundle everything together.
 * The popup is also bundled as IIFE for simplicity.
 */
export default defineConfig(({ mode }) => {
  // We build each entry separately to ensure self-contained output
  const entry = process.env.BUILD_ENTRY || 'content'

  const entries: Record<string, { input: string; outDir: string; fileName?: string }> = {
    content: {
      input: resolve(__dirname, 'src/content/index.ts'),
      outDir: 'dist/content',
    },
    'web-content': {
      input: resolve(__dirname, 'src/content/web-content.ts'),
      outDir: 'dist/content',
      fileName: 'web-content.js',
    },
    background: {
      input: resolve(__dirname, 'src/background/service-worker.ts'),
      outDir: 'dist/background',
    },
    popup: {
      input: resolve(__dirname, 'popup/popup.tsx'),
      outDir: 'dist/popup',
    },
  }

  const current = entries[entry]!

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: current.outDir,
      emptyOutDir: entry !== 'web-content',
      lib: {
        entry: current.input,
        formats: ['iife'],
        name: `FollowGWS_${entry.replace(/-/g, '_')}`,
        fileName: () => current.fileName || (entry === 'background' ? 'service-worker.js' : entry === 'popup' ? 'popup.js' : 'index.js'),
      },
      rollupOptions: {
        output: {
          // Inline all dynamic imports for self-contained bundles
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
