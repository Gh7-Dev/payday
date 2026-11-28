export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const headers: Record<string, string> = {};
  let bodyInit: BodyInit | undefined;
  if (body !== undefined) {
    if (contentType === 'text/csv') {
      headers['Content-Type'] = 'text/csv';
      bodyInit = body as string;
    } else {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(body);
    }
  }
  const res = await fetch('/api' + path, { method, credentials: 'include', headers, body: bodyInit });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    const j = json as Record<string, string>;
    throw new ApiError(res.status, j.error ?? 'unknown', j.message ?? j.error ?? res.statusText);
  }
  return json as T;
}

const get = <T>(path: string) => call<T>('GET', path);
const post = <T>(path: string, body?: unknown) => call<T>('POST', path, body);

// GET /config
export interface ConfigResponse {
  chain: string;
  cluster: string;
  programId: string;
  backendKey: string;
  programmeAddress: string | null;
  mint: string | null;
  startTs: string | null;
  dayLen: string | null;
  days: number | null;
}
export const getConfig = () => get<ConfigResponse>('/config');

// POST /auth/nonce
export const authNonce = (wallet: string) =>
  post<{ nonce: string; message: string; expiresAt: number }>('/auth/nonce', { wallet });

// POST /auth/verify
export const authVerify = (wallet: string, signature: string) =>
  post<{ ok: true; wallet: string }>('/auth/verify', { wallet, signature });

// GET /auth/me
export const authMe = () => get<{ wallet: string }>('/auth/me');

// POST /events
export interface CreateEventBody {
  name: string;
  startDate: string;
  endDate: string;
  dayLenSeconds: number;
  decimals: number;
  tokenMint: string;
  maxParticipants: number;
}
export const createEvent = (body: CreateEventBody) => post<Record<string, unknown>>('/events', body);

// POST /events/:id/trainers
export const addTrainer = (id: string, name: string, phone: string) =>
  post<{ id: string; eventId: string; name: string; phone: string; state: string }>(
    `/events/${id}/trainers`, { name, phone });

// POST /events/:id/participants/csv
export interface CsvOkResponse { ok: true; count: number; perDayTotals: string[]; grandTotal: string; }
export interface CsvErrorResponse { ok: false; errors: unknown[]; }
export const uploadCsv = (id: string, csv: string) =>
  call<CsvOkResponse | CsvErrorResponse>('POST', `/events/${id}/participants/csv`, csv, 'text/csv');

// POST /events/:id/links
export const createLink = (id: string, type: 'trainee' | 'trainer') =>
  post<{ linkId: string; eventId: string; type: string; code: string }>(`/events/${id}/links`, { type });

// GET /events/:id
export const getEvent = (id: string) => get<Record<string, unknown>>(`/events/${id}`);

// POST /events/:id/trainers/sync
export const syncTrainers = (id: string) =>
  post<{ registered: number; pending: number }>(`/events/${id}/trainers/sync`);

// GET /events/:id/chain-status
export interface ChainStatus {
  phase: 'not_created' | 'not_started' | 'running' | 'ended' | 'reclaimed';
  programme: string | null;
  vaultBalance: string | null;
  currentDay: number | null;
  endTs: string | null;
  reclaimable: boolean;
}
export const getChainStatus = (id: string) => get<ChainStatus>(`/events/${id}/chain-status`);

// POST /trainer/signup
export const trainerSignup = (body: {
  linkCode: string; username: string; phone: string; password: string;
  wallet: string; encryptedKeyBlob: string;
}) => post<{ state: string }>('/trainer/signup', body);

// POST /trainer/unlock
export const trainerUnlock = (linkCode: string, username: string, password: string) =>
  post<{ wallet: string; encryptedKeyBlob: string; state: string }>(
    '/trainer/unlock', { linkCode, username, password });

// POST /claim
export const claim = (body: {
  linkCode: string; phone: string; pin: string;
  wallet: string; encryptedKeyBlob: string;
}) => post<{ state: string }>('/claim', body);

// POST /claim/unlock
export const claimUnlock = (linkCode: string, phone: string, pin: string) =>
  post<{ wallet: string; encryptedKeyBlob: string }>('/claim/unlock', { linkCode, phone, pin });

// POST /relay
export const postRelay = (eventId: string, tx: string) =>
  post<{ id: string; expiresAt: number }>('/relay', { eventId, tx });

// GET /relay/:id
export const getRelay = (id: string) =>
  get<{ tx: string; expiresAt: number; secondsLeft: number }>(`/relay/${id}`);
