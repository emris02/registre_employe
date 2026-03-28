import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Configuration Vite + React
// Proxy des requêtes `/api` vers le backend Node local pendant le développement.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@features': path.resolve(__dirname, 'src/features'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@types': path.resolve(__dirname, 'src/types')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom']
        }
      }
    }
  },
  define: {
    // Éviter d'exposer les variables d'environnement dans le build
    'import.meta.env.VITE_NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    'import.meta.env.VITE_DEBUG': JSON.stringify('false'),
    'import.meta.env.VITE_LOG_LEVEL': JSON.stringify('error')
  }
})

