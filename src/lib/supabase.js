import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    '[hma-cadence] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env and fill in your Supabase project details.'
  );
}

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder',
  {
    auth: { persistSession: false }, // we manage our own session
  },
);

export const MOVEMENT_CATEGORIES = [
  { key: 'lunge',              label: 'Lunge',              cssVar: '--cat-lunge' },
  { key: 'single_leg_dip',     label: 'Single Leg Dip',     cssVar: '--cat-single-leg-dip' },
  { key: 'shoulder_reach',     label: 'Shoulder Reach',     cssVar: '--cat-shoulder-reach' },
  { key: 'trunk_rotation',     label: 'Trunk Rotation',     cssVar: '--cat-trunk-rotation' },
  { key: 'cervical_rotation',  label: 'Cervical Rotation',  cssVar: '--cat-cervical-rotation' },
];

// Matches the Tracker's 5 clinical exercise types (see plan-payload-contract.md §5).
export const EXERCISE_TYPES = [
  { key: 'flexibility',           label: 'Flexibility' },
  { key: 'mobility',              label: 'Mobility' },
  { key: 'static_stabilization',  label: 'Static Stabilization' },
  { key: 'dynamic_stabilization', label: 'Dynamic Stabilization' },
  { key: 'strength',              label: 'Strength' },
];

export const PAIN_CATEGORIES = [
  { key: 'pain_during',  label: 'Pain during' },
  { key: 'pain_after',   label: 'Pain after' },
  { key: 'discomfort',   label: 'Discomfort' },
  { key: 'other',        label: 'Other' },
];
