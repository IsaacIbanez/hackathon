import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Overlay } from './app/overlay/Overlay.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
)
