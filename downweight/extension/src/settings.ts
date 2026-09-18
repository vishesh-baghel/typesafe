import { clampThreshold, clampWeight, DEFAULT_THRESHOLD, DEFAULT_WEIGHTS, type Weights } from '../../lib/composite';
import { DIM_KEYS } from '../../lib/types';

export interface Settings {
  apiKey: string;
  weights: Weights;
  threshold: number;
  dimming: boolean;
  enabled: boolean;
}

export const DEFAULTS: Settings = {
  apiKey: '',
  weights: { ...DEFAULT_WEIGHTS },
  threshold: DEFAULT_THRESHOLD,
  dimming: false,
  enabled: true,
};

/**
 * `chrome.storage.local`, never `sync`.
 *
 * Sync would replicate the reader's API key into their Google account and onto every
 * machine signed into that profile. The key is theirs and it stays on the machine they
 * put it on. It is still readable by anyone with access to that machine, like any
 * extension credential, and the README says so rather than implying otherwise.
 */
export function normalise(raw: unknown): Settings {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;

  const weights = { ...DEFAULT_WEIGHTS };
  const given = (typeof obj.weights === 'object' && obj.weights !== null ? obj.weights : {}) as Partial<Weights>;
  for (const key of DIM_KEYS) {
    if (typeof given[key] === 'number') weights[key] = clampWeight(given[key]);
  }

  return {
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
    weights,
    threshold: typeof obj.threshold === 'number' ? clampThreshold(obj.threshold) : DEFAULT_THRESHOLD,
    dimming: obj.dimming === true,
    enabled: obj.enabled !== false,
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(null);
  return normalise(raw);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalise({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set(next);
  return next;
}
