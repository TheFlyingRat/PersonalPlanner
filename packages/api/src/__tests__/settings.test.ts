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

import { createTestApp, authHeaders, TEST_API_KEY } from './helpers.js';

beforeAll(() => {
  process.env.API_KEY = TEST_API_KEY;
  process.env.NODE_ENV = 'test';
});

import settingsRouter from '../routes/settings.js';

const app = createTestApp('settings', settingsRouter);

const defaultUser = {
  id: 'default-user',
  googleRefreshToken: null,
  googleSyncToken: null,
  settings: JSON.stringify({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
  }),
  createdAt: '2026-01-01T00:00:00.000Z',
};

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockAll.mockReturnValue([]);
  mockDb._mockGet.mockReturnValue(undefined);
  mockDb._mockWhere.mockReturnValue({ get: mockDb._mockGet, all: mockDb._mockAll });
  mockDb._mockFrom.mockReturnValue({ all: mockDb._mockAll, where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
  mockDb.delete.mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockDb._mockRun }) });
}

describe('GET /api/settings', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth header', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 404 when no user exists', async () => {
    mockDb._mockAll.mockReturnValueOnce([]);

    const res = await request(app)
      .get('/api/settings')
      .set(authHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No user found');
  });

  it('returns user settings', async () => {
    mockDb._mockAll.mockReturnValueOnce([defaultUser]);

    const res = await request(app)
      .get('/api/settings')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('default-user');
    expect(res.body.settings.timezone).toBe('America/New_York');
    expect(res.body.settings.workingHours.start).toBe('09:00');
  });

  it('returns default settings when user has no settings field', async () => {
    mockDb._mockAll.mockReturnValueOnce([{ ...defaultUser, settings: null }]);

    const res = await request(app)
      .get('/api/settings')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.settings.timezone).toBe('America/New_York');
    expect(res.body.settings.schedulingWindowDays).toBe(14);
  });
});

describe('PUT /api/settings', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ timezone: 'UTC' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid working hours format', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authHeaders())
      .send({
        workingHours: { start: 'bad', end: '17:00' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid schedulingWindowDays (negative)', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authHeaders())
      .send({ schedulingWindowDays: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 when no user exists', async () => {
    mockDb._mockAll.mockReturnValueOnce([]);

    const res = await request(app)
      .put('/api/settings')
      .set(authHeaders())
      .send({ timezone: 'UTC' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No user found');
  });

  it('updates settings with valid timezone', async () => {
    mockDb._mockAll.mockReturnValueOnce([defaultUser]);
    mockDb._mockSet.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ run: mockDb._mockRun }),
    });
    const updatedUser = {
      ...defaultUser,
      settings: JSON.stringify({
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '07:00', end: '22:00' },
        timezone: 'Europe/London',
        schedulingWindowDays: 14,
      }),
    };
    mockDb._mockWhere.mockReturnValueOnce({
      get: vi.fn().mockReturnValue(updatedUser),
      all: mockDb._mockAll,
    });

    const res = await request(app)
      .put('/api/settings')
      .set(authHeaders())
      .send({ timezone: 'Europe/London' });

    expect(res.status).toBe(200);
    expect(res.body.settings.timezone).toBe('Europe/London');
  });

  it('merges partial settings update (working hours only)', async () => {
    mockDb._mockAll.mockReturnValueOnce([defaultUser]);
    mockDb._mockSet.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ run: mockDb._mockRun }),
    });
    const updatedUser = {
      ...defaultUser,
      settings: JSON.stringify({
        workingHours: { start: '08:00', end: '16:00' },
        personalHours: { start: '07:00', end: '22:00' },
        timezone: 'America/New_York',
        schedulingWindowDays: 14,
      }),
    };
    mockDb._mockWhere.mockReturnValueOnce({
      get: vi.fn().mockReturnValue(updatedUser),
      all: mockDb._mockAll,
    });

    const res = await request(app)
      .put('/api/settings')
      .set(authHeaders())
      .send({ workingHours: { start: '08:00', end: '16:00' } });

    expect(res.status).toBe(200);
    expect(res.body.settings.workingHours.start).toBe('08:00');
    expect(res.body.settings.timezone).toBe('America/New_York');
  });
});

describe('GET /api/settings/google/status', () => {
  beforeEach(resetMocks);

  it('returns connected false when no refresh token', async () => {
    mockDb._mockAll.mockReturnValueOnce([defaultUser]);

    const res = await request(app)
      .get('/api/settings/google/status')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it('returns connected true when refresh token exists', async () => {
    mockDb._mockAll.mockReturnValueOnce([
      { ...defaultUser, googleRefreshToken: 'encrypted-token' },
    ]);

    const res = await request(app)
      .get('/api/settings/google/status')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });
});

describe('POST /api/settings/google/disconnect', () => {
  beforeEach(resetMocks);

  it('returns 404 when no user exists', async () => {
    mockDb._mockAll.mockReturnValueOnce([]);

    const res = await request(app)
      .post('/api/settings/google/disconnect')
      .set(authHeaders());

    expect(res.status).toBe(404);
  });

  it('disconnects Google successfully', async () => {
    mockDb._mockAll.mockReturnValueOnce([defaultUser]);
    mockDb._mockSet.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ run: mockDb._mockRun }),
    });

    const res = await request(app)
      .post('/api/settings/google/disconnect')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Google disconnected');
  });
});
