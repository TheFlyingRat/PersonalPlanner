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

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockRun }) }),
    // Expose inner mocks for test control
    _mockAll: mockAll,
    _mockGet: mockGet,
    _mockRun: mockRun,
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockSet: mockSet,
  };

  return { mockDb };
});

vi.mock('../db/index.js', () => ({ db: mockDb }));

import { createTestApp, authHeaders, TEST_API_KEY } from './helpers.js';

beforeAll(() => {
  process.env.API_KEY = TEST_API_KEY;
  process.env.NODE_ENV = 'test';
});

import habitsRouter from '../routes/habits.js';

const app = createTestApp('habits', habitsRouter);

function makeHabitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'habit-1',
    name: 'Morning Run',
    priority: 2,
    windowStart: '06:00',
    windowEnd: '09:00',
    idealTime: '07:00',
    durationMin: 30,
    durationMax: 60,
    frequency: 'daily',
    frequencyConfig: null,
    schedulingHours: 'working',
    locked: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/habits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock chain
    mockDb._mockAll.mockReturnValue([]);
    mockDb._mockGet.mockReturnValue(undefined);
    mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
    mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
    mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
    mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
    mockDb.update.mockReturnValue({ set: mockDb._mockSet });
    mockDb.delete.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
  });

  it('returns 401 without auth header', async () => {
    const res = await request(app).get('/api/habits');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns empty list when no habits exist', async () => {
    mockDb._mockAll.mockReturnValue([]);
    const res = await request(app)
      .get('/api/habits')
      .set(authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns list of habits', async () => {
    const row = makeHabitRow();
    mockDb._mockAll.mockReturnValueOnce([row]);

    const res = await request(app)
      .get('/api/habits')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Morning Run');
    expect(res.body[0].frequency).toBe('daily');
  });
});

describe('POST /api/habits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._mockAll.mockReturnValue([]);
    mockDb._mockGet.mockReturnValue(undefined);
    mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
    mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
    mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
    mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  });

  it('creates a habit with valid body', async () => {
    const newHabit = makeHabitRow({ id: 'new-id' });
    mockDb._mockGet.mockReturnValueOnce(newHabit);

    const res = await request(app)
      .post('/api/habits')
      .set(authHeaders())
      .send({
        name: 'Morning Run',
        windowStart: '06:00',
        windowEnd: '09:00',
        idealTime: '07:00',
        durationMin: 30,
        durationMax: 60,
        frequency: 'daily',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Morning Run');
  });

  it('returns 400 with missing required fields', async () => {
    const res = await request(app)
      .post('/api/habits')
      .set(authHeaders())
      .send({ name: 'Missing fields' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid frequency', async () => {
    const res = await request(app)
      .post('/api/habits')
      .set(authHeaders())
      .send({
        name: 'Bad Habit',
        windowStart: '06:00',
        windowEnd: '09:00',
        idealTime: '07:00',
        durationMin: 30,
        durationMax: 60,
        frequency: 'never',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid priority (out of range)', async () => {
    const res = await request(app)
      .post('/api/habits')
      .set(authHeaders())
      .send({
        name: 'Bad Priority',
        windowStart: '06:00',
        windowEnd: '09:00',
        idealTime: '07:00',
        durationMin: 30,
        durationMax: 60,
        frequency: 'daily',
        priority: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid time format', async () => {
    const res = await request(app)
      .post('/api/habits')
      .set(authHeaders())
      .send({
        name: 'Bad Time',
        windowStart: '25:00',
        windowEnd: '09:00',
        idealTime: '07:00',
        durationMin: 30,
        durationMax: 60,
        frequency: 'daily',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('PUT /api/habits/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._mockAll.mockReturnValue([]);
    mockDb._mockGet.mockReturnValue(undefined);
    mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
    mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
    mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
    mockDb.update.mockReturnValue({ set: mockDb._mockSet });
    mockDb._mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._mockWhere.mockReturnValueOnce({
      get: vi.fn().mockReturnValue(undefined),
      all: mockDb._mockAll,
    });

    const res = await request(app)
      .put('/api/habits/nonexistent')
      .set(authHeaders())
      .send({ name: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('updates a habit with valid body', async () => {
    const existing = makeHabitRow();
    const updated = makeHabitRow({ name: 'Evening Run' });

    // First .where() call: find existing
    mockDb._mockWhere
      .mockReturnValueOnce({ get: vi.fn().mockReturnValue(existing), all: mockDb._mockAll })
      // Third .where() call: find updated (after set().where().run())
      .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updated), all: mockDb._mockAll });

    const res = await request(app)
      .put('/api/habits/habit-1')
      .set(authHeaders())
      .send({ name: 'Evening Run' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Evening Run');
  });
});

describe('DELETE /api/habits/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._mockAll.mockReturnValue([]);
    mockDb._mockGet.mockReturnValue(undefined);
    mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
    mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
    mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
    mockDb.delete.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._mockWhere.mockReturnValueOnce({
      get: vi.fn().mockReturnValue(undefined),
      all: mockDb._mockAll,
    });

    const res = await request(app)
      .delete('/api/habits/nonexistent')
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('deletes an existing habit', async () => {
    const existing = makeHabitRow();
    mockDb._mockWhere.mockReturnValueOnce({
      get: vi.fn().mockReturnValue(existing),
      all: mockDb._mockAll,
    });

    const res = await request(app)
      .delete('/api/habits/habit-1')
      .set(authHeaders());

    expect(res.status).toBe(204);
  });
});
