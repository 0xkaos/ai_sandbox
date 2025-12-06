import { tool } from 'ai';
import { z } from 'zod';
import {
  createCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from '@/lib/google/calendar';

const listEventsSchema = z.object({
  calendarId: z.string().min(1).optional(),
  timeMin: z.string().datetime().optional(),
  timeMax: z.string().datetime().optional(),
  maxResults: z.number().int().min(1).max(25).optional(),
});

const attendeeSchema = z.object({
  email: z.string().email(),
  optionalName: z.string().min(1).optional(),
});

const createEventSchema = z.object({
  calendarId: z.string().min(1).optional(),
  summary: z.string().min(1, 'Event summary is required.'),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timeZone: z.string().optional(),
  attendees: z.array(attendeeSchema).optional(),
});

const updateEventSchema = z
  .object({
    calendarId: z.string().min(1).optional(),
    eventId: z.string().min(1, 'eventId is required.'),
    summary: z.string().min(1).optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    timeZone: z.string().optional(),
    attendees: z.array(attendeeSchema).optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.summary ||
          data.description ||
          data.location ||
          (data.startTime && data.endTime) ||
          data.timeZone ||
          (data.attendees && data.attendees.length > 0)
      ),
    { message: 'Provide at least one field to update besides IDs.' }
  )
  .refine(
    (data) => (!data.startTime && !data.endTime) || (data.startTime && data.endTime),
    { message: 'startTime and endTime must be provided together when updating times.' }
  );

export function buildCalendarTools(userId: string) {
  const listEvents = tool({
    name: 'google_calendar_list_events',
    description: 'List upcoming Google Calendar events for the authenticated user.',
    parameters: listEventsSchema,
  } as any);

  (listEvents as any).execute = async (input: z.infer<typeof listEventsSchema>) => {
    const events = await listCalendarEvents(userId, input);
    if (events.length === 0) {
      return 'No events found for the requested window.';
    }

    return {
      calendarId: input.calendarId ?? 'primary',
      count: events.length,
      events,
    };
  };

  const createEvent = tool({
    name: 'google_calendar_create_event',
    description:
      'Create a Google Calendar event for the authenticated user. Always provide startTime and endTime in ISO 8601 format.',
    parameters: createEventSchema,
  } as any);

  (createEvent as any).execute = async (input: z.infer<typeof createEventSchema>) => {
    const event = await createCalendarEvent(userId, input);
    return {
      calendarId: input.calendarId ?? 'primary',
      event,
    };
  };

  const updateEvent = tool({
    name: 'google_calendar_update_event',
    description:
      'Update an existing Google Calendar event by ID. Use this when the user wants to modify details (time, description, etc.) without creating a duplicate.',
    parameters: updateEventSchema,
  } as any);

  (updateEvent as any).execute = async (input: z.infer<typeof updateEventSchema>) => {
    const event = await updateCalendarEvent(userId, input);
    return {
      calendarId: input.calendarId ?? 'primary',
      event,
    };
  };

  return { listEvents, createEvent, updateEvent } as const;
}
