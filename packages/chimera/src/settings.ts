// Plain values shared by the package and an app (no CHIMERA code here).

/** The mouth positions, in the order of the vowel chart's rim (back rounded to front), so that
 *  each blend between neighbours is itself a vowel. `setMouth(i)` takes an index into this. */
export const MOUTH = ['U', 'O', 'A', 'E', 'I'] as const;
export type Vowel = (typeof MOUTH)[number];

/** The articulators a player moves (CHIMERA's names; the tongue tip follows the tongue body). */
export const ARTIC_KEYS = ['jaw', 'tbX', 'tbY', 'lipAp', 'lipProt', 'velum', 'larynx'] as const;
export type ArticKey = (typeof ARTIC_KEYS)[number];
export type Articulation = Record<ArticKey, number>;

/** The handles of CHIMERA's 2D head: the head can ring one (the knob that moves it). */
export type HandleId = 'tongue' | 'tip' | 'jaw' | 'lips' | 'velum' | 'larynx';

/** A body between the three calibrated ones: `female` from the adult male (0) to the adult female
 *  (1), `child` from adult (0) to child (1). */
export interface BodyMix {
  female: number;
  child: number;
}
