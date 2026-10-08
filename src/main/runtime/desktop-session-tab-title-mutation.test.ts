import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeWithCloseHeadlessMobileTerminalTab } from './orca-runtime-close-headless-mobile-terminal-tab'

vi.mock('./orca-runtime-close-structured-agent-session-tab', () => ({
  OrcaRuntimeWithCloseStructuredAgentSessionTab: class {}
}))

function createHost(desktop: boolean, renameBridge = true) {
  const host = {
    getValidatedExplicitWorktreeIdSelector: () => 'folder:workspace',
    getAvailableAuthoritativeWindow: () => (desktop ? {} : null),
    mobileSessionTabsByWorktree: new Map([['folder:workspace', {}]]),
    resolveMobileSessionHostTabId: () => 'parent-tab',
    notifier: renameBridge ? { renameTerminal: vi.fn() } : undefined,
    persistHeadlessSessionTabProps: vi.fn(),
    applyHeadlessSessionTabPropsToSnapshot: vi.fn()
  }
  return {
    host,
    update: (args: { tabId: string; customTitle?: string | null; color?: string | null }) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This host supplies every dependency read by the tab-props method; other inherited runtime methods are unreachable.
      const receiver = host as unknown as OrcaRuntimeWithCloseHeadlessMobileTerminalTab
      return OrcaRuntimeWithCloseHeadlessMobileTerminalTab.prototype.setMobileSessionTabProps.call(
        receiver,
        'id:folder:workspace',
        args
      )
    }
  }
}

describe('paired-client title writes to the owning desktop', () => {
  it.each(['User task name', null])(
    'forwards %s using the existing renderer rename bridge',
    async (customTitle) => {
      const { host, update } = createHost(true)
      await update({ tabId: 'parent-tab::leaf', customTitle })
      expect(host.notifier?.renameTerminal).toHaveBeenCalledWith('parent-tab', customTitle)
      expect(host.persistHeadlessSessionTabProps).not.toHaveBeenCalled()
      expect(host.applyHeadlessSessionTabPropsToSnapshot).not.toHaveBeenCalled()
    }
  )

  it('does not clear a title when a legacy client sends only color', async () => {
    const { host, update } = createHost(true)
    await update({ tabId: 'parent-tab', color: null })
    expect(host.notifier?.renameTerminal).not.toHaveBeenCalled()
  })

  it('rejects a rename when the owning renderer bridge is unavailable', async () => {
    const { host, update } = createHost(true, false)
    await expect(update({ tabId: 'parent-tab', customTitle: 'Task' })).rejects.toThrow(
      'rename bridge is unavailable'
    )
    expect(host.persistHeadlessSessionTabProps).not.toHaveBeenCalled()
  })

  it('keeps headless persistence and snapshot fan-out', async () => {
    const { host, update } = createHost(false)
    const args = { tabId: 'parent-tab::leaf', customTitle: 'Headless task' }
    await update(args)
    expect(host.notifier?.renameTerminal).not.toHaveBeenCalled()
    expect(host.persistHeadlessSessionTabProps).toHaveBeenCalledWith(
      'folder:workspace',
      'parent-tab',
      args
    )
    expect(host.applyHeadlessSessionTabPropsToSnapshot).toHaveBeenCalledWith(
      'folder:workspace',
      'parent-tab',
      args
    )
  })
})
