import axios from 'axios';

/**
 * The attendance station's API client.
 *
 * Deliberately NOT `apiClient`: that interceptor attaches the logged-in user's
 * JWT, and the station runs with nobody logged in. This client sends only the
 * device token, so a station cannot accidentally act with an admin's session
 * that happens to be in localStorage.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001/api';

const stationClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

export type PunchType = 'in' | 'out' | 'break_start' | 'break_end';

export interface StationContext {
  station: { id: number; label: string };
  branch: { id: number; name: string | null };
  policy: { primary_method: string; require_photo: boolean };
}

export interface StationPunchResult {
  duplicate: boolean;
  punch_id: number;
  employee: {
    id: number;
    full_name: string;
    employee_code?: string;
    photo_url?: string | null;
  };
  punch_type: PunchType;
  punched_at: string;
  work_date?: string | null;
  /** True when no shift claimed the punch — recorded, but needs a manager. */
  orphan?: boolean;
}

const auth = (token: string) => ({ headers: { 'x-station-token': token } });

export const stationService = {
  context: async (token: string): Promise<StationContext> => {
    const { data } = await stationClient.get('/attendance-station/context', auth(token));
    return data;
  },

  punch: async (
    token: string,
    payload: {
      punch_type: PunchType;
      employee_code?: string;
      pin?: string;
      qr_token?: string;
      photo_url?: string;
    },
  ): Promise<StationPunchResult> => {
    const { data } = await stationClient.post(
      '/attendance-station/punch',
      payload,
      auth(token),
    );
    return data;
  },
};

/**
 * Punch photos are uploaded with the device token too, so the station never
 * needs a user session.
 */
export async function uploadStationPhoto(
  token: string,
  blob: Blob,
): Promise<{ url: string | null; reason: string | null }> {
  try {
    const form = new FormData();
    form.append('file', blob, `punch-${Date.now()}.jpg`);
    const { data } = await stationClient.post('/attendance-station/photo', form, {
      headers: { 'x-station-token': token, 'Content-Type': 'multipart/form-data' },
    });
    const url = (data?.url as string) ?? null;
    return { url, reason: url ? null : 'server returned no URL' };
  } catch (err) {
    // Reported rather than swallowed: a punch still records without a photo,
    // but somebody has to be able to see WHY the photos stopped arriving.
    const res = (err as { response?: { status?: number; data?: { message?: string } } })
      .response;
    return {
      url: null,
      reason: res?.data?.message ?? (res?.status ? `upload failed (${res.status})` : 'upload failed'),
    };
  }
}
