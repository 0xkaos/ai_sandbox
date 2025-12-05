import { StructuredTool } from '@langchain/core/tools';
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

export class ListCalendarEventsTool extends StructuredTool<typeof listEventsSchema> {
  name = 'google_calendar_list_events';
  description = 'List upcoming Google Calendar events for the authenticated user.';
  schema = listEventsSchema;

  constructor(private readonly userId: string) {
    super();
  }

  protected async _call(input: z.infer<typeof listEventsSchema>): Promise<string> {
    try {
      const events = await listCalendarEvents(this.userId, input);
      if (events.length === 0) {
        return 'No events found for the requested window.';
      }

      return JSON.stringify({
        calendarId: input.calendarId ?? 'primary',
        count: events.length,
        events,
      });
    } catch (error) {
      throw new Error(
        `Unable to list calendar events: ${error instanceof Error ? error.message : 'Unknown error.'}`
      );
    }
  }
}

export class CreateCalendarEventTool extends StructuredTool<typeof createEventSchema> {
  name = 'google_calendar_create_event';
  description = 'Create a Google Calendar event for the authenticated user. Always provide startTime and endTime in ISO 8601 format.';
  schema = createEventSchema;

  constructor(private readonly userId: string) {
    super();
  }

  protected async _call(input: z.infer<typeof createEventSchema>): Promise<string> {
    try {
      const event = await createCalendarEvent(this.userId, input);
      return JSON.stringify({
        calendarId: input.calendarId ?? 'primary',
        event,
      });
    } catch (error) {
      throw new Error(
        `Unable to create calendar event: ${error instanceof Error ? error.message : 'Unknown error.'}`
      );
    }
  }
}

export class UpdateCalendarEventTool extends StructuredTool<typeof updateEventSchema> {
  name = 'google_calendar_update_event';
  description =
    'Update an existing Google Calendar event by ID. Use this when the user wants to modify details (time, description, etc.) without creating a duplicate.';
  schema = updateEventSchema;

  constructor(private readonly userId: string) {
    super();
  }

  protected async _call(input: z.infer<typeof updateEventSchema>): Promise<string> {
    try {
      const event = await updateCalendarEvent(this.userId, input);
      return JSON.stringify({
        calendarId: input.calendarId ?? 'primary',
        event,
      });
    } catch (error) {
      throw new Error(
        `Unable to update calendar event: ${error instanceof Error ? error.message : 'Unknown error.'}`
      );
    }
  }
}

export function getGoogleCalendarTools(userId: string) {
  return [
    new ListCalendarEventsTool(userId),
    new CreateCalendarEventTool(userId),
    new UpdateCalendarEventTool(userId),
  ];
}
