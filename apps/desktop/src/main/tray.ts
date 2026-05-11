import { Menu, Tray, app, nativeImage, shell } from "electron";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MESSAGES,
  type DaemonStatusSnapshot,
  type ServiceRuntimeState,
  type SidecarStamp,
  type WebStatusSnapshot,
} from "@open-design/sidecar-proto";
import { requestJsonIpc, resolveAppIpcPath, type SidecarRuntimeContext } from "@open-design/sidecar";

const REFRESH_INTERVAL_MS = 2500;
const STATUS_TIMEOUT_MS = 600;

export type TrayController = {
  close(): void;
  refresh(): Promise<void>;
};

export type TrayHandlers = {
  onHideWindow(): void;
  onQuit(): void;
  onShowWindow(): void;
};

type ServiceSnapshot = {
  ok: boolean;
  pid?: number | null;
  state?: ServiceRuntimeState;
  url?: string | null;
};

function describeService(label: string, snapshot: ServiceSnapshot): string {
  if (!snapshot.ok) return `${label} · offline`;
  const parts: string[] = [];
  parts.push(snapshot.state ?? "running");
  if (snapshot.pid != null) parts.push(`pid ${snapshot.pid}`);
  return `${label} · ${parts.join(" · ")}`;
}

function indicator(daemon: ServiceSnapshot, web: ServiceSnapshot): string {
  if (daemon.ok && web.ok) return "● OD";
  if (daemon.ok || web.ok) return "◐ OD";
  return "○ OD";
}

export function createTray(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  handlers: TrayHandlers,
): TrayController {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("○ OD");
  tray.setToolTip("Open Design");

  let daemon: ServiceSnapshot = { ok: false };
  let web: ServiceSnapshot = { ok: false };
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const daemonIpc = resolveAppIpcPath({
    app: APP_KEYS.DAEMON,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    namespace: runtime.namespace,
  });
  const webIpc = resolveAppIpcPath({
    app: APP_KEYS.WEB,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    namespace: runtime.namespace,
  });

  function rebuildMenu(): void {
    const webUrl = web.url ?? null;
    const daemonUrl = daemon.url ?? null;

    const menu = Menu.buildFromTemplate([
      { enabled: false, label: "Open Design" },
      { type: "separator" },
      {
        enabled: webUrl != null,
        label: webUrl != null ? `Web · ${webUrl}` : describeService("Web", web),
        click: () => {
          if (webUrl != null) void shell.openExternal(webUrl);
        },
      },
      {
        enabled: daemonUrl != null,
        label: daemonUrl != null ? `Daemon · ${daemonUrl}` : describeService("Daemon", daemon),
        click: () => {
          if (daemonUrl != null) void shell.openExternal(daemonUrl);
        },
      },
      { type: "separator" },
      { label: "Show Window", click: () => handlers.onShowWindow() },
      { label: "Hide Window", click: () => handlers.onHideWindow() },
      {
        enabled: webUrl != null,
        label: "Open Web in Browser",
        click: () => {
          if (webUrl != null) void shell.openExternal(webUrl);
        },
      },
      { type: "separator" },
      { label: "Quit Open Design", click: () => handlers.onQuit() },
    ]);
    tray.setContextMenu(menu);
    tray.setTitle(indicator(daemon, web));
  }

  rebuildMenu();

  // Left-click on macOS shows the menu by default for context menus assigned via setContextMenu.
  // Clicking the icon also surfaces the menu, so no extra handler is needed.

  async function fetchDaemon(): Promise<ServiceSnapshot> {
    const status = await requestJsonIpc<DaemonStatusSnapshot>(
      daemonIpc,
      { type: SIDECAR_MESSAGES.STATUS },
      { timeoutMs: STATUS_TIMEOUT_MS },
    ).catch(() => null);
    if (status == null) return { ok: false };
    return { ok: true, pid: status.pid ?? null, state: status.state, url: status.url };
  }

  async function fetchWeb(): Promise<ServiceSnapshot> {
    const status = await requestJsonIpc<WebStatusSnapshot>(
      webIpc,
      { type: SIDECAR_MESSAGES.STATUS },
      { timeoutMs: STATUS_TIMEOUT_MS },
    ).catch(() => null);
    if (status == null) return { ok: false };
    return { ok: true, pid: status.pid ?? null, state: status.state, url: status.url };
  }

  async function refresh(): Promise<void> {
    if (stopped) return;
    const [d, w] = await Promise.all([fetchDaemon(), fetchWeb()]);
    daemon = d;
    web = w;
    rebuildMenu();
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void refresh()
        .catch((error: unknown) => {
          console.error("desktop tray refresh failed", error);
        })
        .finally(() => schedule());
    }, REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  void refresh()
    .catch((error: unknown) => {
      console.error("desktop tray initial refresh failed", error);
    })
    .finally(() => schedule());

  app.on("activate", () => {
    handlers.onShowWindow();
  });

  return {
    close() {
      if (stopped) return;
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      tray.destroy();
    },
    refresh,
  };
}
