import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const sharedDependencyAliases = {
  '@': path.resolve(__dirname, './src/renderer'),
  react: path.resolve(__dirname, './node_modules/react'),
  'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
  'lucide-react': path.resolve(__dirname, './node_modules/lucide-react'),
  'react-markdown': path.resolve(__dirname, './node_modules/react-markdown'),
  'rehype-highlight': path.resolve(__dirname, './node_modules/rehype-highlight'),
  'remark-gfm': path.resolve(__dirname, './node_modules/remark-gfm'),
}

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/integration/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/*.test.ts', 'node_modules/**', 'dist/**', 'dist-electron/**', 'dist-test/**', 'release/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/main/backend-launch.ts',
        'src/main/diagnostics-report.ts',
        'src/main/startup-profile-runtime.ts',
        'src/shared/app-config.ts',
        'src/shared/desktop-settings.ts',
        'src/shared/diagnostics.ts',
        'src/shared/onboarding.ts',
        'src/renderer/components/new/SettingsPanel.tsx',
        'src/renderer/components/new/settings/desktopSettingsController.ts',
      ],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      }
    },
  },
  resolve: {
    alias: sharedDependencyAliases,
  },
})
