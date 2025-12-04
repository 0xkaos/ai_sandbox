import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000; // Refresh 2 minutes before expiry

type GoogleTokenRow = {
  id: string;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiresAt: Date | null;
  googleScopes: string | null;
};

export type GoogleCredentials = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
};

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

async function fetchGoogleTokenRow(userId: string): Promise<GoogleTokenRow | undefined> {
  const [record] = await db
    .select({
      id: users.id,
      googleAccessToken: users.googleAccessToken,
      googleRefreshToken: users.googleRefreshToken,
      googleTokenExpiresAt: users.googleTokenExpiresAt,
      googleScopes: users.googleScopes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return record;
}

export async function getGoogleCredentialsForUser(userId: string): Promise<GoogleCredentials> {
  const record = await fetchGoogleTokenRow(userId);
  if (!record) {
    throw new GoogleAuthError('User record not found.');
  }

  return {
    accessToken: record.googleAccessToken,
    refreshToken: record.googleRefreshToken,
    expiresAt: record.googleTokenExpiresAt,
    scopes: record.googleScopes,
  };
}

function ensureGoogleEnvVar(name: 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'): string {
  const value = process.env[name];
  if (!value) {
    throw new GoogleAuthError(`${name} is not configured.`);
  }
  return value;
}

function tokenIsExpiringSoon(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return false;
  }
  const threshold = Date.now() + TOKEN_REFRESH_BUFFER_MS;
  return expiresAt.getTime() <= threshold;
}

export async function refreshGoogleAccessToken(userId: string) {
  const credentials = await getGoogleCredentialsForUser(userId);
  if (!credentials.refreshToken) {
    throw new GoogleAuthError('Google account is missing a refresh token. Please reconnect.');
  }

  const clientId = ensureGoogleEnvVar('GOOGLE_CLIENT_ID');
  const clientSecret = ensureGoogleEnvVar('GOOGLE_CLIENT_SECRET');

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new GoogleAuthError(`Failed to refresh Google token: ${errorText}`);
  }

  const body = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    refresh_token?: string;
  };

  const expiresAt = body.expires_in
    ? new Date(Date.now() + body.expires_in * 1000)
    : null;
  const nextRefreshToken = body.refresh_token ?? credentials.refreshToken;
  const nextScopes = body.scope ?? credentials.scopes;

  await db
    .update(users)
    .set({
      googleAccessToken: body.access_token,
      googleRefreshToken: nextRefreshToken,
      googleTokenExpiresAt: expiresAt,
      googleScopes: nextScopes,
    })
    .where(eq(users.id, userId));

  return {
    accessToken: body.access_token,
    refreshToken: nextRefreshToken,
    expiresAt,
    scopes: nextScopes ?? null,
  } satisfies GoogleCredentials;
}

export async function getValidGoogleAccessToken(userId: string) {
  const credentials = await getGoogleCredentialsForUser(userId);
  if (!credentials.accessToken) {
    throw new GoogleAuthError('Google Calendar access is not configured for this account.');
  }

  if (!tokenIsExpiringSoon(credentials.expiresAt)) {
    return credentials;
  }

  return refreshGoogleAccessToken(userId);
}
