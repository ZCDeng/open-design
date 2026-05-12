// PostHog browser client wrapper. Lazy-loads posthog-js only after the
// daemon /api/analytics/config response confirms a key is present, so dev
// builds and forks impose zero runtime cost. All entry points are
// fire-and-forget: capture failures must never propagate to product code.

import type { PostHog } from 'posthog-js';
import {
  EVENT_SCHEMA_VERSION,
  type AnalyticsClientType,
  type AnalyticsConfigResponse,
} from '@open-design/contracts/analytics';

interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  locale: string;
  appVersion: string;
}

let client: PostHog | null = null;
let initPromise: Promise<PostHog | null> | null = null;
let resolvedAnonymousId: string | null = null;

// Returns the installationId the daemon stamped on /api/analytics/config
// after the user opted in via Privacy → "Share usage data". The provider
// uses this in preference to its locally-generated UUID so PostHog,
// Langfuse, and any future sink share a single anonymous identity.
export function getResolvedAnonymousId(): string | null {
  return resolvedAnonymousId;
}

export async function getAnalyticsClient(
  context: AnalyticsContext,
): Promise<PostHog | null> {
  if (client) return client;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const res = await fetch('/api/analytics/config');
      if (!res.ok) return null;
      const cfg = (await res.json()) as AnalyticsConfigResponse;
      if (!cfg.enabled || !cfg.key || !cfg.host) return null;
      const distinctId =
        (typeof cfg.installationId === 'string' && cfg.installationId) ||
        context.anonymousId;
      resolvedAnonymousId = distinctId;
      const mod = await import('posthog-js');
      const posthog = mod.default;
      posthog.init(cfg.key, {
        api_host: cfg.host,
        // Identify by installationId when present so daemon-side captures
        // (which also key off installationId via the analytics context
        // header) land on the same person record. Falls back to the
        // locally-generated UUID for the legacy / pre-consent path.
        bootstrap: { distinctID: distinctId },
        // Disable session recording and autocapture; this integration is
        // event-based only. A future spec can opt in selectively.
        disable_session_recording: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        persistence: 'localStorage',
        loaded: (instance) => {
          instance.register({
            event_schema_version: EVENT_SCHEMA_VERSION,
            ui_version: context.appVersion,
            app_version: context.appVersion,
            client_type: context.clientType,
            locale: context.locale,
            session_id: context.sessionId,
            anonymous_id: distinctId,
          });
        },
      });
      client = posthog;
      return posthog;
    } catch {
      // Network failure, missing endpoint, third-party fork without keys —
      // all collapse to the same no-op.
      return null;
    }
  })();
  return initPromise;
}

// Called from the AnalyticsProvider when the user toggles Privacy →
// metrics off so events stop flowing immediately, before the next
// reload re-reads /api/analytics/config. The posthog-js client persists
// its opt-out flag in localStorage; subsequent capture() calls become
// no-ops until the user opts back in.
export function applyConsent(consentGranted: boolean): void {
  if (!client) return;
  try {
    if (consentGranted) {
      client.opt_in_capturing();
    } else {
      client.opt_out_capturing();
    }
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

export function capture(
  client: PostHog | null,
  args: {
    event: string;
    properties: Record<string, unknown>;
    insertId: string;
    requestId?: string | null;
  },
): void {
  if (!client) return;
  try {
    client.capture(args.event, {
      ...args.properties,
      event_id: args.insertId,
      // PostHog's official dedup key. The daemon mirrors result events with
      // the same $insert_id so duplicates from the dual-side capture pattern
      // get coalesced server-side.
      $insert_id: args.insertId,
      ...(args.requestId ? { request_id: args.requestId } : {}),
    });
  } catch {
    // Swallow — analytics failures must not propagate.
  }
}
