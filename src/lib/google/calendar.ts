import { google, calendar_v3 } from 'googleapis';
import { getValidGoogleAccessToken, GoogleAuthError } from './oauth';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEFAULT_CALENDAR_ID = 'primary';
const DEFAULT_TIME_ZONE = 'UTC';

export type NormalizedCalendarEvent = {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  timeZone: string | null;
  attendees: Array<{ email: string; responseStatus: string | null }>;
  htmlLink: string | null;
  hangoutLink: string | null;
};

export type ListCalendarEventsOptions = {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
};

export type CreateCalendarEventInput = {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  attendees?: Array<{ email: string; optionalName?: string }>;
};

export type UpdateCalendarEventInput = {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  attendees?: Array<{ email: string; optionalName?: string }>;
};

export async function getCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
  const { accessToken } = await getValidGoogleAccessToken(userId);
  if (!accessToken) {
    throw new GoogleAuthError('Missing Google access token.');
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ access_token: accessToken });

  return google.calendar({ version: 'v3', auth });
}

function normalizeCalendarEvent(event?: calendar_v3.Schema$Event): NormalizedCalendarEvent {
  return {
    id: event?.id ?? 'unknown',
    summary: event?.summary ?? 'Untitled event',
    description: event?.description ?? null,
    location: event?.location ?? null,
    start: event?.start?.dateTime ?? event?.start?.date ?? null,
    end: event?.end?.dateTime ?? event?.end?.date ?? null,
    timeZone: event?.start?.timeZone ?? event?.end?.timeZone ?? null,
    attendees:
      event?.attendees?.map((attendee) => ({
        email: attendee.email ?? 'unknown',
        responseStatus: attendee.responseStatus ?? null,
      })) ?? [],
    htmlLink: event?.htmlLink ?? null,
    hangoutLink: event?.hangoutLink ?? null,
  };
}

export async function listCalendarEvents(
  userId: string,
  options: ListCalendarEventsOptions = {}
): Promise<NormalizedCalendarEvent[]> {
  const calendarId = options.calendarId ?? DEFAULT_CALENDAR_ID;
  const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 25);
  const client = await getCalendarClient(userId);

  const response = await client.events.list({
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
    timeMin: options.timeMin ?? new Date().toISOString(),
    ...(options.timeMax ? { timeMax: options.timeMax } : {}),
  });

  return (response.data.items ?? []).map(normalizeCalendarEvent);
}

export async function getCalendarEvent(
  userId: string,
  calendarId: string = DEFAULT_CALENDAR_ID,
  eventId: string
): Promise<NormalizedCalendarEvent> {
  const client = await getCalendarClient(userId);
  const response = await client.events.get({ calendarId, eventId });
  if (!response.data) {
    throw new Error('Event not found.');
  }
  return normalizeCalendarEvent(response.data);
}

export async function createCalendarEvent(
  userId: string,
  input: CreateCalendarEventInput
): Promise<NormalizedCalendarEvent> {
  const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const client = await getCalendarClient(userId);

  const response = await client.events.insert({
    calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startTime,
        timeZone,
      },
      end: {
        dateTime: input.endTime,
        timeZone,
      },
      attendees: input.attendees?.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.optionalName,
      })),
    },
  });

  return normalizeCalendarEvent(response.data);
}

export async function updateCalendarEvent(
  userId: string,
  input: UpdateCalendarEventInput
): Promise<NormalizedCalendarEvent> {
  const calendarId = input.calendarId ?? DEFAULT_CALENDAR_ID;
  const client = await getCalendarClient(userId);

  const hasTimeUpdate = Boolean(input.startTime) || Boolean(input.endTime);
  if (input.startTime && !input.endTime) {
    throw new Error('endTime is required when updating startTime.');
  }
  if (!input.startTime && input.endTime) {
    throw new Error('startTime is required when updating endTime.');
  }

  const hasFieldUpdate =
    hasTimeUpdate ||
    Boolean(input.summary) ||
    Boolean(input.description) ||
    Boolean(input.location) ||
    Boolean(input.timeZone) ||
    Boolean(input.attendees?.length);

  if (!hasFieldUpdate) {
    throw new Error('Provide at least one field to update.');
  }

  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const requestBody: calendar_v3.Schema$Event = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    ...(hasTimeUpdate
      ? {
          start: {
            dateTime: input.startTime,
            timeZone,
          },
          end: {
            dateTime: input.endTime,
            timeZone,
          },
        }
      : {}),
    attendees: input.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.optionalName,
    })),
  };

  const response = await client.events.patch({
    calendarId,
    eventId: input.eventId,
    requestBody,
  });

  return normalizeCalendarEvent(response.data);
}
