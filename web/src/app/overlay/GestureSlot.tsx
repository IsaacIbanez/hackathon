import { useLayoutEffect, useRef } from 'react'
import { gestureRoot, setGestureVariant, type GestureVariant } from './gestureHost.ts'

/**
 * Where the overlay's single Gesture Control page is shown (gestureHost.ts): the page is moved into
 * this element when it appears. The move happens in the same task as React's update, so the
 * camera keeps playing.
 */
export function GestureSlot({ variant, className }: { variant: GestureVariant; className?: string }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = gestureRoot()
    if (!slot.current || !root) return
    slot.current.appendChild(root)
    setGestureVariant(variant)
  }, [variant])
  return <div ref={slot} className={className} />
}
