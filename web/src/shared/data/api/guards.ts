// Small checks the contract parsers share. Each throws `ContractError` with the path of the
// offending value, so a failure names where the response went wrong.

/** A response or event that does not match the contract. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

export type Obj = Record<string, unknown>;

export function fail(path: string, expected: string): never {
  throw new ContractError(`${path}: expected ${expected}`);
}

/** An object whose keys are exactly `required` plus any of `optional`. */
export function exact(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object');
  const obj = value as Obj;
  for (const key of required) if (!(key in obj)) fail(`${path}.${key}`, 'a value');
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'no such field');
  }
  return obj;
}

export function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string');
  return value as string;
}

export function nullableStr(value: unknown, path: string): string | null {
  return value === null ? null : str(value, path);
}

export function int(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(path, `an integer of at least ${min}`);
  }
  return value as number;
}

export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'a boolean');
  return value as boolean;
}

export function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(path, `one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function list<T>(value: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, 'an array');
  return (value as unknown[]).map((entry, i) => item(entry, `${path}[${i}]`));
}
