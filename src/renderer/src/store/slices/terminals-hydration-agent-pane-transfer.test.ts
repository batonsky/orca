import './terminal-hydration-store-test-bootstrap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'
import { resetAgentPaneAuthorityAliasesForTests } from './agent-pane-authority'
import { selectLiveAgentStatusEntriesForWorktree } from '@/components/sidebar/worktree-agent-row-selectors'
import { buildWorktreeAgentRows } from '@/components/sidebar/worktree-agent-rows'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn()
}))

const WORKTREE = 'repo1::/wt-1'
const OLD_LEAF = '11111111-1111-4111-8111-111111111111'
const NEW_LEAF = '22222222-2222-4222-8222-222222222222'
const SOURCE = makePaneKey('old-tab', OLD_LEAF)
const TARGET = makePaneKey('new-tab', NEW_LEAF)

afterEach(() => resetAgentPaneAuthorityAliasesForTests())

function hydrate(sourceIncarnation = 'same-process', targetIncarnation = 'same-process') {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: { repo1: [makeWorktree({ id: WORKTREE, repoId: 'repo1', path: '/wt-1' })] }
  })
  store.getState().setAgentStatus(SOURCE, {
    state: 'done',
    prompt: 'kept conversation',
    agentType: 'codex'
  })
  const layout = (leafId: string) => ({
    root: { type: 'leaf' as const, leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: 'shared-pty' }
  })
  store.getState().hydrateWorkspaceSession({
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [WORKTREE]: [
        makeTab({ id: 'old-tab', worktreeId: WORKTREE, ptyId: 'shared-pty' }),
        makeTab({ id: 'new-tab', worktreeId: WORKTREE, ptyId: 'shared-pty' })
      ]
    },
    terminalLayoutsByTabId: { 'old-tab': layout(OLD_LEAF), 'new-tab': layout(NEW_LEAF) },
    terminalPtyIncarnationsByPaneKey: { [SOURCE]: sourceIncarnation, [TARGET]: targetIncarnation },
    unifiedTabs: {
      [WORKTREE]: [
        {
          id: 'unified-new',
          entityId: 'new-tab',
          contentType: 'terminal',
          worktreeId: WORKTREE,
          groupId: 'group',
          label: 'Conversation',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }
  })
  return store
}

describe('canonical terminal hydration keeps the agent row', () => {
  it('shows the completed conversation on its surviving tab and routes late old-key hooks there', () => {
    const store = hydrate()
    const state = store.getState()
    const rows = buildWorktreeAgentRows({
      tabs: state.tabsByWorktree[WORKTREE] ?? [],
      entries: selectLiveAgentStatusEntriesForWorktree(state, WORKTREE),
      retained: [],
      terminalLayoutsByTabId: state.terminalLayoutsByTabId,
      now: Date.now()
    })
    expect(rows).toEqual([
      expect.objectContaining({
        paneKey: TARGET,
        state: 'done',
        tab: expect.objectContaining({ id: 'new-tab' })
      })
    ])
    store.getState().setAgentStatus(SOURCE, { state: 'working', prompt: 'next turn' })
    expect(store.getState().agentStatusByPaneKey[SOURCE]).toBeUndefined()
    expect(store.getState().agentStatusByPaneKey[TARGET]?.state).toBe('working')
  })

  it.each([
    ['old-process', 'new-process'],
    ['', 'same-process']
  ])(
    'does not transfer status without matching process generations (%s / %s)',
    (source, target) => {
      const state = hydrate(source, target).getState()
      expect(state.agentStatusByPaneKey[TARGET]).toBeUndefined()
      expect(state.agentStatusByPaneKey[SOURCE]?.state).toBe('done')
    }
  )
})
