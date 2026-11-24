// Plain values shared by the package and an app (no CHIMERA code here).

export type Body = 'male' | 'female' | 'child';
export const BODIES: ReadonlyArray<Body> = ['male', 'female', 'child'];

/** The mouth positions, in the order of the vowel chart's rim (back rounded to front), so that
 *  each blend between neighbours is itself a vowel. `setMouth(i)` takes an index into this. */
export const MOUTH = ['U', 'O', 'A', 'E', 'I'] as const;
export type Vowel = (typeof MOUTH)[number];
