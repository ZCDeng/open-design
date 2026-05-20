// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenDesignHostUpdaterStatusListener, OpenDesignHostUpdaterStatusSnapshot } from '@open-design/host';
import { installMockOpenDesignHost } from '@open-design/host/testing';

import { UpdaterPopup } from '../../src/components/UpdaterPopup';
import { I18nProvider } from '../../src/i18n';

function idleStatus(): OpenDesignHostUpdaterStatusSnapshot {
  return {
    arch: 'arm64',
    capabilities: {
      canApplyInPlace: false,
      canDownload: true,
      canOpenInstaller: true,
      requiresManualInstall: true,
    },
    channel: 'beta',
    currentVersion: '1.2.3-beta.3',
    enabled: true,
    mode: 'package-launcher',
    platform: 'darwin',
    state: 'idle',
    supported: true,
  };
}

function downloadedStatus(overrides: Partial<OpenDesignHostUpdaterStatusSnapshot> = {}): OpenDesignHostUpdaterStatusSnapshot {
  return {
    ...idleStatus(),
    availableVersion: '1.2.3-beta.4',
    downloadPath: '/tmp/open-design-updater/Open Design Beta.dmg',
    state: 'downloaded',
    ...overrides,
  };
}

describe('UpdaterPopup', () => {
  let restoreHost: (() => void) | null = null;

  afterEach(() => {
    cleanup();
    restoreHost?.();
    restoreHost = null;
  });

  it('waits for host status and installs with one click from the popup', async () => {
    let status = downloadedStatus();
    const install = vi.fn(async () => {
      status = downloadedStatus({
        installResult: {
          dryRun: true,
          openedAt: '2026-05-19T00:00:00.000Z',
          path: status.downloadPath ?? '/tmp/open-design-updater/Open Design Beta.dmg',
        },
      });
      return status;
    });
    const quit = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => status),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    expect(screen.getByText('Open Design 1.2.3-beta.4 is ready. Click Install and quit to close Open Design and open the installer.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('updater-install-button'));
    await waitFor(() => expect(install).toHaveBeenCalledWith({ payload: { source: 'updater-popup' } }));
    await waitFor(() => expect(quit).toHaveBeenCalledWith({ payload: { source: 'updater-popup' } }));
    expect(await screen.findByRole('dialog', { name: 'Installer opened' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitting...' }).getAttribute('disabled')).not.toBeNull();
  });

  it('reacts to updater subscription events without polling-only behavior', async () => {
    const listeners = new Set<OpenDesignHostUpdaterStatusListener>();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => idleStatus()),
          subscribe: vi.fn((listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }),
        },
      },
    });

    render(<UpdaterPopup />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('updater-popup')).toBeNull();

    act(() => {
      for (const listener of listeners) listener(downloadedStatus());
    });
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    expect(screen.getByTestId('entry-nav-updater')).toBeTruthy();
  });

  it('uses localized updater copy from the app i18n provider', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(
      <I18nProvider initial="zh-CN">
        <UpdaterPopup />
      </I18nProvider>,
    );

    expect(await screen.findByRole('dialog', { name: '更新已就绪' })).toBeTruthy();
    expect(screen.getByTestId('updater-install-button').textContent).toBe('安装并退出');
    expect(screen.getByText('Open Design 1.2.3-beta.4 已就绪。点击“安装并退出”会关闭 Open Design 并打开安装器。')).toBeTruthy();
  });

  it('dismisses the popup when clicking outside it', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('updater-popup')).toBeNull();
  });

  it('dismisses the auto-opened popup when clicking the updater control again', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('entry-nav-updater'));
    expect(screen.queryByTestId('updater-popup')).toBeNull();
  });

  it('keeps the popup locked open while install and quit is in flight', async () => {
    let resolveInstall: (status: OpenDesignHostUpdaterStatusSnapshot) => void = () => undefined;
    const install = vi.fn(() => new Promise<OpenDesignHostUpdaterStatusSnapshot>((resolve) => {
      resolveInstall = resolve;
    }));
    const quit = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('updater-install-button'));
    fireEvent.click(screen.getByTestId('updater-install-button'));
    expect(install).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Opening installer...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' }).getAttribute('disabled')).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(screen.getByTestId('updater-popup')).toBeTruthy();
    fireEvent.click(screen.getByTestId('entry-nav-updater'));
    expect(screen.getByTestId('updater-popup')).toBeTruthy();

    await act(async () => {
      resolveInstall(downloadedStatus({
        installResult: {
          dryRun: true,
          openedAt: '2026-05-19T00:00:00.000Z',
          path: '/tmp/open-design-updater/Open Design Beta.dmg',
        },
      }));
      await Promise.resolve();
    });
    await waitFor(() => expect(quit).toHaveBeenCalledWith({ payload: { source: 'updater-popup' } }));
  });

  it('hides the updater control while an update is downloading', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus({
            progress: {
              receivedBytes: 50,
              totalBytes: 100,
            },
            state: 'downloading',
          })),
        },
      },
    });

    render(<UpdaterPopup />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('entry-nav-updater')).toBeNull();
    expect(screen.queryByTestId('updater-popup')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the popup open when opening the installer returns an updater error state', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install: vi.fn(async () => downloadedStatus({
            error: {
              code: 'open-installer-failed',
              message: 'fixture open failed',
            },
            state: 'error',
          })),
          status: vi.fn(async () => downloadedStatus()),
        },
      },
    });

    render(<UpdaterPopup />);
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('updater-install-button'));
    expect(await screen.findByRole('dialog', { name: 'Update failed' })).toBeTruthy();
    expect(screen.getByText('fixture open failed')).toBeTruthy();
  });

  it('keeps a retry quit action if Open Design cannot quit after opening the installer', async () => {
    let status = downloadedStatus();
    const install = vi.fn(async () => {
      status = downloadedStatus({
        installResult: {
          dryRun: true,
          openedAt: '2026-05-19T00:00:00.000Z',
          path: status.downloadPath ?? '/tmp/open-design-updater/Open Design Beta.dmg',
        },
      });
      return status;
    });
    const quit = vi.fn(async () => ({ ok: false as const, reason: 'fixture quit failed' }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => status),
        },
      },
    });

    render(<UpdaterPopup />);

    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('updater-install-button'));
    expect(await screen.findByRole('dialog', { name: 'Could not quit' })).toBeTruthy();
    expect(screen.getByText('fixture quit failed')).toBeTruthy();
    expect(screen.getByTestId('updater-quit-button')).toBeTruthy();
  });

  it('keeps background update errors silent until an installer is ready', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => downloadedStatus({
            downloadPath: undefined,
            error: {
              code: 'update-store-invalid-shape',
              message: 'update store contains unexpected root entries',
            },
            state: 'error',
          })),
        },
      },
    });

    render(<UpdaterPopup />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('entry-nav-updater')).toBeNull();
    expect(screen.queryByTestId('updater-popup')).toBeNull();
  });
});
