/**
 * Domain constants — pure data, no backend dependency.
 *
 * Kept free of any database-client dependency so views and the data layer can
 * import them directly. Keys here are the canonical HMA vocabulary and must
 * stay in lock-step with the plan payload contract
 * (docs/plan-payload-contract.md).
 */

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

// Employee difficulty signal on an exercise — matches the SQL `feedback_rating`
// enum ('thumbs_up' | 'thumbs_down'). `prompt` is what the employee taps.
export const FEEDBACK_RATINGS = [
  { key: 'thumbs_up',   icon: '👍', prompt: 'Going well', adminLabel: 'Going well' },
  { key: 'thumbs_down', icon: '👎', prompt: 'Too hard',   adminLabel: 'Struggling' },
];
