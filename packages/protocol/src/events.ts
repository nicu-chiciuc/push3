// What the Push sends, decoded: the events of @push3/protocol and the state the controller keeps.
export type RGB = readonly [number, number, number];

interface PadBase {
  readonly type: 'pad';
  readonly note: number;
  readonly rowFromTop: number;
  readonly col: number;
  readonly ch: number;
  virtual?: boolean;
}

/** Everything the Push (or the 3D twin) can tell us, already decoded from MIDI. */
export type PushEvent =
  | (PadBase & { readonly action: 'down'; readonly velocity: number })
  | (PadBase & { readonly action: 'up' })
  | (PadBase & { readonly action: 'pressure'; readonly pressure: number })
  | (PadBase & { readonly action: 'bend'; readonly x: number })
  | (PadBase & { readonly action: 'slide'; readonly y: number })
  | { readonly type: 'button'; readonly id: string; readonly cc: number; readonly label: string; readonly pressed: boolean; readonly unmapped?: boolean; virtual?: boolean }
  | { readonly type: 'encoder'; readonly id: string; readonly delta: number; virtual?: boolean }
  | { readonly type: 'touch'; readonly id: string; readonly touched: boolean; virtual?: boolean }
  | { readonly type: 'strip'; readonly value: number; virtual?: boolean }
  | { readonly type: 'channelPressure'; readonly pressure: number; virtual?: boolean }
  | { readonly type: 'sysex'; readonly data: ReadonlyArray<number>; virtual?: boolean }
  | { readonly type: 'other'; readonly what: string; virtual?: boolean };

export type PadEvent = Extract<PushEvent, { type: 'pad' }>;

export interface PadState {
  down: boolean;
  velocity: number;
  pressure: number;
  /** −1..1 left/right roll (MPE per-note pitch bend) */
  x: number;
  /** 0..1 up/down slide (MPE CC 74) */
  y: number;
  ch: number;
}
