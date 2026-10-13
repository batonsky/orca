import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentHookServer } from '../../../agent-hooks/server'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createPtyIpcSpawnState } from './spawn-state'
import { commitPtyIpcSpawn } from './spawn-commit'
import type { PtySpawnIpcDeps } from './spawn-types'
import { ptySizes } from '../delivery/visibility-state'
import { ptyIncarnationById, ptyOwnership } from '../provider/ownership-state'

const SOURCE = makePaneKey('source-tab', '11111111-1111-4111-8111-111111111111')
const TARGET_LEAF = '22222222-2222-4222-8222-222222222222'
const TARGET = makePaneKey('target-tab', TARGET_LEAF)
const PTY = 'reattach-agent-pane-transfer'

afterEach(() => {
  agentHookServer.clearPaneState(TARGET)
  agentHookServer.clearPaneState(SOURCE)
  ptySizes.delete(PTY)
  ptyOwnership.delete(PTY)
  ptyIncarnationById.delete(PTY)
})

async function commit(options: {
  savedIncarnation?: string
  liveIncarnation?: string
  failSave?: boolean
}) {
  const session = {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: { 'wt-1': [{ id: 'source-tab' }, { id: 'target-tab' }] },
    terminalLayoutsByTabId: {
      'source-tab': {
        root: { type: 'leaf', leafId: SOURCE.split(':')[1] },
        ptyIdsByLeafId: { [SOURCE.split(':')[1]!]: PTY }
      }
    },
    terminalPtyIncarnationsByPaneKey: { [SOURCE]: options.savedIncarnation ?? 'process-1' }
  }
  const ports = {
    store: {
      getWorkspaceSession: () => session,
      persistPtyBinding: options.failSave
        ? vi.fn().mockRejectedValue(new Error('disk full'))
        : vi.fn().mockResolvedValue(true)
    },
    sendPtySpawnedToRenderer: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this commit uses only the supplied persistence and notification ports; no runtime or provider is launched.
  const deps = ports as unknown as PtySpawnIpcDeps
  const ctx = createPtyIpcSpawnState(deps, {
    worktreeId: 'wt-1',
    tabId: 'target-tab',
    leafId: TARGET_LEAF,
    cols: 80,
    rows: 24
  })
  ctx.validatedLeafId = TARGET_LEAF
  ctx.validatedPaneKey = TARGET
  ctx.result = { id: PTY, incarnationId: options.liveIncarnation ?? 'process-1', isReattach: true }
  agentHookServer.ingestTerminalStatus({
    paneKey: SOURCE,
    tabId: 'source-tab',
    worktreeId: 'wt-1',
    payload: { state: 'done', prompt: 'completed conversation', agentType: 'codex' }
  })
  return commitPtyIpcSpawn(ctx)
}

describe('reattach commit preserves agent status ownership', () => {
  it('moves the host row and future physical-key observations to the committed tab', async () => {
    await commit({})
    expect(agentHookServer.getStatusSnapshot()).toEqual([
      expect.objectContaining({ paneKey: TARGET, tabId: 'target-tab', state: 'done' })
    ])
    agentHookServer.ingestTerminalStatus({
      paneKey: SOURCE,
      tabId: 'source-tab',
      worktreeId: 'wt-1',
      payload: { state: 'working', prompt: 'next turn' }
    })
    expect(agentHookServer.getStatusSnapshot()).toEqual([
      expect.objectContaining({ paneKey: TARGET, prompt: 'next turn' })
    ])
  })

  it('does not move a row for a reused PTY id with a different process', async () => {
    await commit({ liveIncarnation: 'process-2' })
    expect(agentHookServer.getStatusSnapshot()).toEqual([
      expect.objectContaining({ paneKey: SOURCE })
    ])
  })

  it('does not move a row when the binding save fails', async () => {
    await expect(commit({ failSave: true })).rejects.toThrow(
      'ORCA_TERMINAL_SESSION_STATE_SAVE_FAILED'
    )
    expect(agentHookServer.getStatusSnapshot()).toEqual([
      expect.objectContaining({ paneKey: SOURCE })
    ])
  })
})
