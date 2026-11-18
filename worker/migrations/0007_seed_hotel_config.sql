-- Migration: 0007_seed_hotel_config
-- Purpose: Insert the mandatory singleton hotel configuration row.
-- The hotel operator must update these values after initial deployment
-- via the PATCH /config endpoint or a subsequent migration.

INSERT INTO hotel_config (
  id,
  hotel_name,
  address_line1,
  city,
  country,
  currency_code,
  timezone,
  checkin_time,
  checkout_time,
  noshow_cutoff_time,
  default_cancellation_hours
) VALUES (
  'hotel',
  'My Hotel',
  '123 Main Street',
  'Bangkok',
  'TH',
  'THB',
  'Asia/Bangkok',
  '14:00',
  '12:00',
  '23:00',
  24
);
