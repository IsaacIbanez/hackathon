import { useCallback, useEffect, useRef, useState } from 'react'
import { WsURL } from '../../wailsjs/go/main/App'
import type { ClientMessage, ServerMessage } from '../api'

/** URL outside Wails: VITE_WS_URL or, by default, the mock server (`task mock`). */
const URL_OUTSIDE_WAILS: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'

/**
 * Inside the Wails app, Go starts its own WebSocket and tells us the URL.
 * In a plain browser (npm run dev) window.go does not exist and the outside URL is used.
 */
export async function resolveWsUrl(): Promise<string> {
  if (import.meta.env.VITE_WS_URL) return URL_OUTSIDE_WAILS
  try {
    const url = await WsURL()
    if (url) return url
  } catch {
    // Not running inside Wails.
  }
  return URL_OUTSIDE_WAILS
}

export type SocketStatus = 'connecting' | 'connected' | 'disconnected'

/** Connection to the contract WebSocket, with a simple reconnect every 2 s. */
export function useSocket(onMessage: (msg: ServerMessage) => void) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [url, setUrl] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = (target: string) => {
      setStatus('connecting')
      const ws = new WebSocket(target)
      wsRef.current = ws
      ws.onopen = () => setStatus('connected')
      ws.onmessage = (e) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(e.data) as ServerMessage
        } catch {
          console.warn('ws: ignoring non-JSON message', e.data)
          return
        }
        onMessageRef.current(msg)
      }
      ws.onclose = () => {
        setStatus('disconnected')
        if (!closed) timer = setTimeout(() => connect(target), 2000)
      }
    }

    resolveWsUrl().then((target) => {
      if (closed) return
      setUrl(target)
      connect(target)
    })

    return () => {
      closed = true
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
