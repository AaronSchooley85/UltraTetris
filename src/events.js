// Tiny synchronous event bus so gameplay modules stay decoupled.
const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}

export function emit(name, data) {
  const list = handlers.get(name);
  if (!list) return;
  for (const fn of list) fn(data);
}
