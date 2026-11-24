// Runs before the upstream processor module (worklet.ts imports this first): it catches the class
// that module registers as "chimera", so worklet.ts can register a subclass under that name instead.
declare function registerProcessor(name: string, ctor: unknown): void;

// bound: the browser's registerProcessor refuses another `this` ("Illegal invocation")
export const upstream: { ctor: unknown; register: (name: string, ctor: unknown) => void } = { ctor: null, register: registerProcessor.bind(globalThis) };

(globalThis as unknown as { registerProcessor: (name: string, ctor: unknown) => void }).registerProcessor = (name, ctor) => {
  if (name === 'chimera') upstream.ctor = ctor;
  else upstream.register(name, ctor);
};
