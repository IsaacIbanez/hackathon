// Test page for the guided reader, without Go: from web/, `npx vite src/document --config vite.config.ts`
// and open http://localhost:5173/demo/. The document is the invented renewal letter
// (scanner/pdf/samples/print/01-carta-renovacion.pdf) read by the scanner pipeline.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { DemoPage } from './DemoPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoPage />
  </StrictMode>,
)
