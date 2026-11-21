import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, ServerMessage } from '../api'

/** URL del WebSocket. Por defecto, el servidor mock (`task mock`). */
export const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'

export type SocketStatus = 'conectando' | 'conectado' | 'desconectado'

/** Conexión al WebSocket del contrato, con reconexión simple cada 2 s. */
export function useSocket(onMessage: (msg: ServerMessage) => void) {
  const [status, setStatus] = useState<SocketStatus>('conectando')
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    let cerrado = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const conectar = () => {
      setStatus('conectando')
      const ws = new WebSocket(WS_URL)
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
        if (!cerrado) timer = setTimeout(conectar, 2000)
      }
    }
    conectar()

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

  return { status, send }
}
