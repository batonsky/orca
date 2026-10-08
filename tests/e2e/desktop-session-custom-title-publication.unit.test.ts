import { describe, expect, it } from 'vitest'
import { projectRuntimeMobileSessionTabs } from '../../src/main/runtime/runtime-mobile-session-projection'
import type { RuntimeMobileSessionProjectionHost } from '../../src/main/runtime/runtime-mobile-session-projection-contract'
import type { RuntimeMobileSessionTabsSnapshot } from '../../src/shared/runtime-types'
import { buildHeadlessMobileSessionTerminalTabs } from '../../src/main/runtime/mobile-session-terminal-projection'
import { buildMobileTerminalSurfaceTabs } from '../../src/renderer/src/runtime/sync-runtime-graph/mobile-session-terminal-tabs'
import type { MobileSessionWorktreeInputs } from '../../src/renderer/src/runtime/sync-runtime-graph/types'

const leafId = '11111111-1111-4111-8111-111111111111'
const host: RuntimeMobileSessionProjectionHost = {
  tabs: new Map(),
  leaves: new Map(),
  ptysById: new Map(),
  getLiveBrowserTabs: () => new Map(),
  getProviderSessionRows: () => [],
  getProviderSessionSnapshot: () => [],
  getStatusSnapshot: () => [],
  getLeafKey: (tabId, leaf) => `${tabId}:${leaf}`,
  findPty: () => null,
  getRetainedStatus: () => null,
  getTrackedTitle: () => 'First prompt',
  issuePtyHandle: () => {
    throw new Error('no live PTY')
  },
  recordPty: () => {
    throw new Error('no live PTY')
  },
  buildPtyStatus: () => ({}),
  sanitizeGroups: () => undefined,
  pruneGroupLayout: () => null,
  collectTabIds: () => new Set()
}
function snapshot(customTitle: string | null | undefined): RuntimeMobileSessionTabsSnapshot {
  return {
    worktree: 'wt-1',
    publicationEpoch: 'desktop-host',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: `term-1::${leafId}`,
    activeTabType: 'terminal',
    tabs: [
      {
        type: 'terminal',
        id: `term-1::${leafId}`,
        parentTabId: 'term-1',
        leafId,
        title: 'First prompt',
        customTitle,
        isActive: true
      }
    ]
  }
}
describe('desktop Remote custom tab title publication', () => {
  it.each(['User task name', null])(
    'forwards authoritative customTitle %s through main projection',
    (customTitle) => {
      const result = projectRuntimeMobileSessionTabs(snapshot(customTitle), host)
      expect(result.tabs[0]).toHaveProperty('customTitle', customTitle)
    }
  )
  it('preserves legacy omission without inventing an authoritative clear', () => {
    expect(projectRuntimeMobileSessionTabs(snapshot(undefined), host).tabs[0]).not.toHaveProperty(
      'customTitle'
    )
  })
  it('retains a headless host rename in the final client payload', () => {
    const session = {
      activeRepoId: null,
      activeWorktreeId: 'wt-1',
      activeTabId: 'term-1',
      tabsByWorktree: {
        'wt-1': [
          {
            id: 'term-1',
            worktreeId: 'wt-1',
            ptyId: null,
            title: 'First prompt',
            customTitle: 'User task name',
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      },
      terminalLayoutsByTabId: {
        'term-1': {
          root: { type: 'leaf' as const, leafId },
          activeLeafId: leafId,
          expandedLeafId: null
        }
      }
    }
    const tabs = buildHeadlessMobileSessionTerminalTabs(
      'wt-1',
      session.tabsByWorktree['wt-1'],
      session
    )
    const result = projectRuntimeMobileSessionTabs(
      { ...snapshot('User task name'), publicationEpoch: 'headless-test', tabs },
      host
    )
    expect(result.tabs[0]).toHaveProperty('customTitle', 'User task name')
  })
  it.each([false, true])('publishes the parent custom title for desktop split=%s', (split) => {
    const terminal = {
      id: 'term-1',
      worktreeId: 'wt-1',
      ptyId: null,
      title: 'First prompt',
      customTitle: 'User task name',
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
    const inputs: MobileSessionWorktreeInputs = {
      worktreeId: 'wt-1',
      worktreeInstanceId: undefined,
      terminalTabs: [terminal],
      browserWorkspaces: [],
      unifiedTabs: [],
      groups: [],
      tabBarOrder: undefined,
      activeGroupId: null,
      tabGroupLayout: undefined,
      openFilesById: undefined,
      openFileIds: [],
      terminalLayoutByTabId: new Map([
        ['term-1', { root: { type: 'leaf', leafId }, activeLeafId: leafId, expandedLeafId: null }]
      ]),
      paneTitlesByTabId: new Map(),
      launchDraftByPaneKey: new Map(),
      agentStatusByPaneKey: new Map(),
      editorDraftVersionByFileId: new Map(),
      pagesByBrowserWorkspaceId: new Map(),
      certificateFailureByBrowserPageId: new Map(),
      activeEditorFileId: null,
      activeEditorTabType: null,
      activeTerminalTabId: 'term-1',
      activeBrowserWorkspaceId: null,
      generatedTitlesEnabled: true,
      terminalTheme: undefined,
      mountedSurfaceCaptureByTabId: new Map()
    }
    if (split) {
      const secondLeaf = '22222222-2222-4222-8222-222222222222'
      inputs.terminalLayoutByTabId = new Map([
        [
          'term-1',
          {
            root: {
              type: 'split',
              direction: 'horizontal',
              first: { type: 'leaf', leafId },
              second: { type: 'leaf', leafId: secondLeaf },
              ratio: 0.5
            },
            activeLeafId: leafId,
            expandedLeafId: null,
            titlesByLeafId: { [leafId]: 'First agent prompt', [secondLeaf]: 'Other agent prompt' }
          }
        ]
      ])
    }
    const tabs = buildMobileTerminalSurfaceTabs(inputs, terminal)
    expect(tabs).toHaveLength(split ? 2 : 1)
    if (split) {
      expect(tabs.map((tab) => tab.title)).toEqual(['First agent prompt', 'Other agent prompt'])
    }
    for (const tab of tabs) {
      expect(tab).toHaveProperty('customTitle', 'User task name')
      if (tab.type !== 'terminal') {
        throw new Error('Expected a terminal surface')
      }
      expect(tab.parentTabId).toBe('term-1')
    }
  })
})
