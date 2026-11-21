// Stand-alone captions page: `npm run dev` in web/, then open /src/captions/page/.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { LiveCaptions } from '../LiveCaptions.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveCaptions />
  </StrictMode>,
)
