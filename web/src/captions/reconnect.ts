// What to do when the connection to Go's /captions closes. Pure, so it is tested
// (test/captions.test.ts): the component only follows the answer.
//
// The bug it fixes (demo, 2026-11-22): without TOGETHER_API_KEY Go accepts the WebSocket, sends
// `no_key` and closes it. The page took that for a lost server, reconnected 1 s later and reset the
// retry counter on every successful connection, so it looped forever and filled the log with one
// `captions: no_key` a second.

/** Waits before each reconnection to Go; after the last one the page gives up and offers local Whisper. */
export const GO_RETRY_MS = [1000, 2000, 4000]

export interface CloseFacts {
  /** The person pressed Stop or switched to local Whisper. */
  stopped: boolean
  /** Go said it cannot go on (no key, a refused key, the cost limit): reconnecting cannot help. */
  fatal: boolean
  /** This connection got `ready` before closing: the captions had worked, so it is a new problem. */
  live: boolean
  /** Reconnections in a row that never got `ready`. */
  retries: number
}

export type CloseAction = { do: 'end' } | { do: 'give-up' } | { do: 'retry'; waitMs: number; retries: number }

export function afterClose(f: CloseFacts): CloseAction {
  if (f.stopped || f.fatal) return { do: 'end' }
  const retries = f.live ? 0 : f.retries
  if (retries >= GO_RETRY_MS.length) return { do: 'give-up' }
  return { do: 'retry', waitMs: GO_RETRY_MS[retries], retries: retries + 1 }
}

/** Error codes from Go after which the session cannot continue (CaptionsEvent.code with retryable=false). */
export function isFatal(code: string | undefined, retryable: boolean | undefined): boolean {
  if (code === 'translation' || code === 'diarization') return false // the captions go on without them
  if (code === 'limit_reached' || code === 'no_key') return true
  return retryable === false
}

/** What the person has to do, for the errors that are about the set-up (shown once). */
export function fatalMessage(code: string | undefined, fromGo: string): string {
  if (code === 'no_key') {
    return 'Transcribe needs a Together AI key. Add TOGETHER_API_KEY=… to the .env file next to the app, then restart the app.'
  }
  if (code === 'upstream' && /401|API key/i.test(fromGo)) {
    return 'Together AI refused the key. Check TOGETHER_API_KEY in the .env file next to the app, then restart the app.'
  }
  return fromGo
}
