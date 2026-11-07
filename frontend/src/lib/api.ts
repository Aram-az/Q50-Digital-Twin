import type { DemoScenario, DrivingSession, SessionStats, TelemetrySample } from './types.ts';

const base = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; database: string }>('/health'),
  sessions: () => request<DrivingSession[]>(`${base}/sessions?limit=100`),
  session: (id: string) => request<DrivingSession>(`${base}/sessions/${encodeURIComponent(id)}`),
  stats: (id: string) => request<SessionStats>(`${base}/sessions/${encodeURIComponent(id)}/stats`),
  // Phase 3 permits at most 500 records per request; fetch additional pages.
  async samples(id: string): Promise<TelemetrySample[]> {
    const all: TelemetrySample[] = [];
    for (let offset = 0; offset < 20000; offset += 500) {
      const page = await request<TelemetrySample[]>(`${base}/sessions/${encodeURIComponent(id)}/samples?offset=${offset}&limit=500`);
      all.push(...page);
      if (page.length < 500) return all;
    }
    throw new Error('This UI limits history to 20,000 samples; use the API for larger exports.');
  },
  startDemo: (scenario: DemoScenario, duration_s: number) => request<{session_id: string;status: string}>(`${base}/demo/sessions`, {
    method: 'POST', body: JSON.stringify({ scenario, duration_s, hz: 10, seed: 42 }),
  }),
  stopDemo: (id: string) => request<{status: string}>(`${base}/demo/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  demoStatus: (id: string) => request<{status: string;sent_samples: number}>(`${base}/demo/sessions/${encodeURIComponent(id)}`),
};

export function websocketUrl(id: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/telemetry/${encodeURIComponent(id)}`;
}
