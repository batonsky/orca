import type { Store } from '../../../persistence'
import type { PtySpawnResult } from '../../../providers/pty-provider-contract'
import { agentHookServer } from '../../../agent-hooks/server'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { resolveTerminalCanonicalPaneTransfers } from '../../../../shared/terminal-canonical-pane-transfers'

// Capture before the binding save can remove the source; apply only after live attach commits.
export function prepareReattachedAgentPaneTransfer(args: {
  store?: Store
  result: PtySpawnResult
  worktreeId?: string
  paneKey: string | null
}): () => void {
  const { store, result, worktreeId, paneKey } = args
  const owner = paneKey ? parsePaneKey(paneKey) : null
  if (
    !store ||
    typeof store.getWorkspaceSession !== 'function' ||
    result.isReattach !== true ||
    !result.incarnationId ||
    !worktreeId ||
    !owner
  )
    return () => {}
  const session = store.getWorkspaceSession()
  const tab = session.tabsByWorktree[worktreeId]?.find((tab) => tab.id === owner.tabId)
  if (!tab) return () => {}
  const transfers = resolveTerminalCanonicalPaneTransfers(
    {
      ...session,
      terminalPtyIncarnationsByPaneKey: {
        ...session.terminalPtyIncarnationsByPaneKey,
        [paneKey!]: result.incarnationId
      }
    },
    { [worktreeId]: [tab] },
    {
      [owner.tabId]: {
        root: { type: 'leaf', leafId: owner.leafId },
        activeLeafId: owner.leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [owner.leafId]: result.id }
      }
    }
  )
  return () => {
    for (const transfer of transfers) {
      agentHookServer.transferPaneAuthority(
        transfer.fromPaneKey,
        transfer.toPaneKey,
        transfer.ptyId,
        Date.now(),
        { authorityVerified: true }
      )
    }
  }
}
