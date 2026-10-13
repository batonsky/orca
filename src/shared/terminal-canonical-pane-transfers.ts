import { isTerminalLeafId, makePaneKey } from './stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from './terminal-tab-types'
import type { WorkspaceSessionState } from './workspace-session-state-types'

export type TerminalCanonicalPaneTransfer = {
  fromPaneKey: string
  toPaneKey: string
  ptyId: string
  incarnationId: string
}

function mountedBindings(layout: TerminalLayoutSnapshot | undefined): [string, string][] {
  const leaves = new Set<string>()
  const visit = (node: TerminalLayoutSnapshot['root']): void => {
    if (!node) {
      return
    }
    if (node.type === 'leaf') {
      leaves.add(node.leafId)
    } else {
      visit(node.first)
      visit(node.second)
    }
  }
  visit(layout?.root ?? null)
  const bindings = Object.entries(layout?.ptyIdsByLeafId ?? {})
  return bindings.filter(
    ([leafId]) =>
      isTerminalLeafId(leafId) && (leaves.has(leafId) || (!layout?.root && bindings.length === 1))
  )
}

// A shared PTY id alone cannot prove that two saved panes describe the same process.
export function resolveTerminalCanonicalPaneTransfers(
  session: WorkspaceSessionState,
  retainedTabs: Record<string, TerminalTab[]>,
  retainedLayouts: Record<string, TerminalLayoutSnapshot>
): TerminalCanonicalPaneTransfer[] {
  const transfers: TerminalCanonicalPaneTransfer[] = []
  for (const [worktreeId, tabs] of Object.entries(retainedTabs)) {
    const owners = new Map<string, string[]>()
    for (const tab of tabs) {
      for (const [leafId, ptyId] of mountedBindings(retainedLayouts[tab.id])) {
        const paneKey = makePaneKey(tab.id, leafId)
        owners.set(ptyId, [...(owners.get(ptyId) ?? []), paneKey])
      }
    }
    for (const tab of session.tabsByWorktree[worktreeId] ?? []) {
      for (const [leafId, ptyId] of mountedBindings(session.terminalLayoutsByTabId[tab.id])) {
        const destinations = owners.get(ptyId)
        if (destinations?.length !== 1) {
          continue
        }
        const fromPaneKey = makePaneKey(tab.id, leafId)
        const toPaneKey = destinations[0]!
        const incarnationId = session.terminalPtyIncarnationsByPaneKey?.[fromPaneKey]
        if (
          fromPaneKey !== toPaneKey &&
          incarnationId &&
          incarnationId === session.terminalPtyIncarnationsByPaneKey?.[toPaneKey]
        ) {
          transfers.push({ fromPaneKey, toPaneKey, ptyId, incarnationId })
        }
      }
    }
  }
  return transfers
}
