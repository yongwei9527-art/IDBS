ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS reservation_slot_keys JSONB NOT NULL DEFAULT '["morning","afternoon","evening","night","daytime"]'::jsonb;

UPDATE devices
SET reservation_slot_keys = '["morning","afternoon","evening","night","daytime"]'::jsonb
WHERE reservation_slot_keys IS NULL
   OR jsonb_typeof(reservation_slot_keys) <> 'array'
   OR jsonb_array_length(reservation_slot_keys) = 0;
