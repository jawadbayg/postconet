export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

class Assertion {
  constructor(
    private readonly actual: unknown,
    private readonly negated = false
  ) {}

  get to() {
    return this;
  }
  get be() {
    return this;
  }
  get have() {
    return this;
  }
  get deep() {
    return this;
  }
  get a() {
    return this;
  }
  get an() {
    return this;
  }
  get not() {
    return new Assertion(this.actual, !this.negated);
  }

  equal(expected: unknown) {
    this.assert(Object.is(this.actual, expected), `expected ${fmt(this.actual)} to equal ${fmt(expected)}`);
  }
  eql(expected: unknown) {
    this.assert(deepEqual(this.actual, expected), `expected ${fmt(this.actual)} to deeply equal ${fmt(expected)}`);
  }
  get ok() {
    this.assert(Boolean(this.actual), `expected ${fmt(this.actual)} to be truthy`);
    return this;
  }
  get true() {
    this.assert(this.actual === true, `expected ${fmt(this.actual)} to be true`);
    return this;
  }
  get false() {
    this.assert(this.actual === false, `expected ${fmt(this.actual)} to be false`);
    return this;
  }
  get null() {
    this.assert(this.actual === null, `expected ${fmt(this.actual)} to be null`);
    return this;
  }
  get undefined() {
    this.assert(this.actual === undefined, `expected ${fmt(this.actual)} to be undefined`);
    return this;
  }
  property(name: string, value?: unknown) {
    const obj = this.actual as Record<string, unknown> | null;
    const has = obj != null && Object.prototype.hasOwnProperty.call(obj, name);
    this.assert(has, `expected object to have property ${name}`);
    if (value !== undefined && has) this.assert(deepEqual(obj![name], value), `expected property ${name} to equal ${fmt(value)}`);
    return new Assertion(has ? obj![name] : undefined, this.negated);
  }
  include(value: unknown) {
    if (typeof this.actual === "string") this.assert(this.actual.includes(String(value)), `expected ${fmt(this.actual)} to include ${fmt(value)}`);
    else if (Array.isArray(this.actual)) this.assert(this.actual.some((item) => deepEqual(item, value)), `expected array to include ${fmt(value)}`);
    else this.assert(false, "include() requires string or array");
  }
  length(n: number) {
    const len = (this.actual as { length?: number }).length;
    this.assert(len === n, `expected length ${len} to equal ${n}`);
  }
  below(n: number) {
    this.assert(Number(this.actual) < n, `expected ${this.actual} to be below ${n}`);
  }
  above(n: number) {
    this.assert(Number(this.actual) > n, `expected ${this.actual} to be above ${n}`);
  }
  status(code: number) {
    const actual = (this.actual as { code?: number; status?: number }).code ?? (this.actual as { status?: number }).status;
    this.assert(actual === code, `expected status ${actual} to equal ${code}`);
  }

  private assert(cond: boolean, message: string) {
    const pass = this.negated ? !cond : cond;
    if (!pass) throw new AssertionError(this.negated ? `NOT: ${message}` : message);
  }
}

export function expect(actual: unknown): Assertion {
  return new Assertion(actual);
}

function fmt(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
