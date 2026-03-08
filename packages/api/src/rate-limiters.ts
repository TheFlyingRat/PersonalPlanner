import rateLimit from 'express-rate-limit';

// Booking rate limiter — applied inline on router handlers in links.ts and booking.ts
export const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many booking requests, please try again later.' },
});
