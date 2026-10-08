import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeWithCloseHeadlessMobileTerminalTab } from './orca-runtime-close-headless-mobile-terminal-tab'
import { OrcaRuntimeWithPersistHeadlessSessionTabProps } from './orca-runtime-persist-headless-session-tab-props'

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

class SnapshotTitlePublisher extends OrcaRuntimeWithPersistHeadlessSessionTabProps {
  publish(props: { title?: string; customTitle?: string | null }): void {
    this.applyHeadlessSessionTabPropsToSnapshot('folder:workspace', 'parent-tab', props)
  }
}

describe('upstream and custom title snapshot updates', () => {
  it.each([
    {
      props: { title: 'Provisioned title' },
      title: 'Provisioned title',
      customTitle: 'User title'
    },
    {
      props: { customTitle: 'Renamed title' },
      title: 'Renamed title',
      customTitle: 'Renamed title'
    },
    { props: { customTitle: null }, title: 'Generated title', customTitle: null }
  ])('publishes $props without losing the other title path', ({ props, title, customTitle }) => {
    const snapshot = {
      snapshotVersion: 1,
      tabs: [
        {
          type: 'terminal',
          parentTabId: 'parent-tab',
          title: 'Old title',
          customTitle: 'User title'
        }
      ]
    }
    const host = {
      applyHeadlessSessionTabPropsToSnapshot: Reflect.get(
        OrcaRuntimeWithPersistHeadlessSessionTabProps.prototype,
        'applyHeadlessSessionTabPropsToSnapshot'
      ),
      mobileSessionTabsByWorktree: new Map([['folder:workspace', snapshot]]),
      getWorkspaceSessionForWorktree: () => ({
        tabsByWorktree: {
          'folder:workspace': [
            {
              id: 'parent-tab',
              sortOrder: 0,
              createdAt: 1,
              customTitle: props.customTitle,
              generatedTitle: 'Generated title'
            }
          ]
        }
      }),
      getMobileSessionTopLevelTabId: () => 'parent-tab',
      resolvePersistedHeadlessTerminalTitle: Reflect.get(
        OrcaRuntimeWithPersistHeadlessSessionTabProps.prototype,
        'resolvePersistedHeadlessTerminalTitle'
      ),
      storeMobileSessionSnapshot: vi.fn(),
      emitMobileSessionTabsSnapshot: vi.fn()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The receiver supplies every dependency used by this snapshot mutation; inherited runtime initialization is unreachable.
    const receiver = host as unknown as SnapshotTitlePublisher
    SnapshotTitlePublisher.prototype.publish.call(receiver, props)
    expect(host.storeMobileSessionSnapshot).toHaveBeenCalledWith(
      'folder:workspace',
      expect.objectContaining({ tabs: [expect.objectContaining({ title, customTitle })] })
    )
    expect(host.emitMobileSessionTabsSnapshot).toHaveBeenCalledWith(
      host.storeMobileSessionSnapshot.mock.calls[0][1]
    )
  })
})
