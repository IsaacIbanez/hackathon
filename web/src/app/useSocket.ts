import { useCallback, useEffect, useRef, useState } from 'react'
import { WsURL } from '../../wailsjs/go/main/App'
import type { ClientMessage, ServerMessage } from '../api'

/** URL fuera de Wails: VITE_WS_URL o, por defecto, el servidor mock (`task mock`). */
const URL_FUERA_DE_WAILS: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'

/**
 * Dentro de la app Wails, Go levanta su propio WebSocket y nos da la URL.
 * En el navegador normal (npm run dev) no existe window.go y se usa la URL de fuera.
 */
export async function resolverWsUrl(): Promise<string> {
  if (import.meta.env.VITE_WS_URL) return URL_FUERA_DE_WAILS
  try {
    const url = await WsURL()
    if (url) return url
  } catch {
    // No estamos dentro de Wails.
  }
  return URL_FUERA_DE_WAILS
}

export type SocketStatus = 'conectando' | 'conectado' | 'desconectado'

/** Conexión al WebSocket del contrato, con reconexión simple cada 2 s. */
export function useSocket(onMessage: (msg: ServerMessage) => void) {
  const [status, setStatus] = useState<SocketStatus>('conectando')
  const [url, setUrl] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    let cerrado = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const conectar = (destino: string) => {
      setStatus('conectando')
      const ws = new WebSocket(destino)
      wsRef.current = ws
      ws.onopen = () => setStatus('conectado')
      ws.onmessage = (e) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(e.data) as ServerMessage
        } catch {
          console.warn('ws: mensaje que no es JSON, se ignora', e.data)
          return
        }
        onMessageRef.current(msg)
      }
      ws.onclose = () => {
        setStatus('desconectado')
        if (!cerrado) timer = setTimeout(() => conectar(destino), 2000)
      }
    }

    resolverWsUrl().then((destino) => {
      if (cerrado) return
      setUrl(destino)
      conectar(destino)
    })

    return () => {
      cerrado = true
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [])

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  return { status, send, url }
}
