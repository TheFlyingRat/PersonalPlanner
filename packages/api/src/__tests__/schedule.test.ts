import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockAll = vi.fn().mockReturnValue([]);
  const mockGet = vi.fn().mockReturnValue(undefined);
  const mockRun = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ get: mockGet, all: mockAll });
  const mockFrom = vi.fn().mockReturnValue({ all: mockAll, where: mockWhere });
  const mockValues = vi.fn().mockReturnValue({
    run: mockRun,
    onConflictDoNothing: vi.fn().mockReturnValue({ run: mockRun }),
  });
  const mockSet = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ run: mockRun }),
  });

  return {
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockRun }) }),
      _mockAll: mockAll,
      _mockGet: mockGet,
      _mockRun: mockRun,
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockValues: mockValues,
      _mockSet: mockSet,
    },
  };
});

vi.mock('../db/index.js', () => ({ db: mockDb }));

vi.mock('@cadence/engine', () => ({
  reschedule: vi.fn().mockReturnValue({ operations: [], unschedulable: [] }),
}));

import { createTestApp, authHeaders, TEST_API_KEY } from './helpers.js';

beforeAll(() => {
  process.env.API_KEY = TEST_API_KEY;
  process.env.NODE_ENV = 'test';
});

import scheduleRouter from '../routes/schedule.js';

const app = createTestApp('schedule', scheduleRouter);

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockAll.mockReturnValue([]);
  mockDb._mockGet.mockReturnValue(undefined);
  mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
  mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb.delete.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
}

describe('GET /api/schedule', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth header', async () => {
    const res = await request(app).get('/api/schedule');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns empty array when no events exist', async () => {
    mockDb._mockAll.mockReturnValue([]);
    mockDb._mockWhere.mockReturnValue({
      get: mockDb._mockGet,
      all: vi.fn().mockReturnValue([]),
    });

    const res = await request(app)
      .get('/api/schedule')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns 400 for invalid start date', async () => {
    const res = await request(app)
      .get('/api/schedule?start=not-a-date')
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid start date format');
  });

  it('returns 400 for invalid end date', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-01-01T00:00:00Z&end=not-a-date')
      .set(authHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid end date format');
  });

  it('returns managed events filtered by date range', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        googleEventId: null,
        calendarId: 'primary',
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
        alternativeSlotsCount: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    // Color lookup: habits.all(), tasks.all(), smartMeetings.all()
    // Then scheduledEvents.all() returns managed events
    // Then calendarEvents.all() returns empty
    mockDb._mockAll
      .mockReturnValueOnce([])             // habits (color lookup)
      .mockReturnValueOnce([])             // tasks (color lookup)
      .mockReturnValueOnce([])             // meetings (color lookup)
      .mockReturnValueOnce(managedEvents)  // scheduledEvents
      .mockReturnValueOnce([]);            // calendarEvents
    // calendars.where(enabled).all() returns empty
    mockDb._mockWhere.mockReturnValueOnce({
      get: mockDb._mockGet,
      all: vi.fn().mockReturnValue([]),
    });

    const res = await request(app)
      .get('/api/schedule?start=2026-03-01T00:00:00Z&end=2026-03-31T00:00:00Z')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('ev-1');
    expect(res.body[0].calendarId).toBe('primary');
  });

  it('returns events without date filter (returns all)', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        googleEventId: null,
        calendarId: null,
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
      },
    ];

    // Color lookup: habits.all(), tasks.all(), smartMeetings.all()
    // Then scheduledEvents.all(), calendarEvents.all()
    mockDb._mockAll
      .mockReturnValueOnce([])             // habits (color lookup)
      .mockReturnValueOnce([])             // tasks (color lookup)
      .mockReturnValueOnce([])             // meetings (color lookup)
      .mockReturnValueOnce(managedEvents)  // scheduledEvents
      .mockReturnValueOnce([]);            // calendarEvents
    mockDb._mockWhere.mockReturnValueOnce({
      get: mockDb._mockGet,
      all: vi.fn().mockReturnValue([]),
    });

    const res = await request(app)
      .get('/api/schedule')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].calendarId).toBe('primary');
  });
});

describe('POST /api/schedule/reschedule', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth header', async () => {
    const res = await request(app).post('/api/schedule/reschedule');
    expect(res.status).toBe(401);
  });

  it('runs reschedule and returns result', async () => {
    mockDb._mockAll.mockReturnValue([]);

    const res = await request(app)
      .post('/api/schedule/reschedule')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reschedule complete');
    expect(res.body.operationsApplied).toBe(0);
    expect(res.body.unschedulable).toEqual([]);
  });
});
