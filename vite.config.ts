import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 npm run dev  -> serwer https (potrzebny do WebXR / czujników na telefonie)
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: { host: true, port: 5187 },
  build: { chunkSizeWarningLimit: 3000 },
  // moduły z three/examples muszą używać tej samej kopii three co reszta aplikacji
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'] },
});
