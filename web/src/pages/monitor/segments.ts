// The path pieces of the monitor's routes, checked before a request is made.
import type { ProjectId } from '../../shared/api/contracts';

const projectIdPattern = /^[0-9a-f]{32}$/;
const attachmentIdPattern = /^[0-9a-f]{32}$/;
const epicIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

export function projectSegment(value: ProjectId): string {
  if (!projectIdPattern.test(value)) throw new TypeError('Invalid monitor project ID.');
  return encodeURIComponent(value);
}

export function epicSegment(value: string): string {
  if (value.length > 64 || !epicIdPattern.test(value))
    throw new TypeError('Invalid monitor epic ID.');
  return encodeURIComponent(value);
}

export function taskSegment(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid monitor task ID.');
  return String(value);
}

export function attachmentSegment(value: string): string {
  if (!attachmentIdPattern.test(value)) throw new TypeError('Invalid monitor attachment ID.');
  return encodeURIComponent(value);
}
