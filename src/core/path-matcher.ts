import picomatch from 'picomatch';

/**
 * Build a path matcher with the same semantics used by repomapper_search:
 * glob patterns match both full paths and basenames (case-insensitive); plain
 * keywords fall back to whitespace-tokenized substring matching.
 */
export function createPathMatcher(pattern: string): (value: string) => boolean {
  if (isGlobPattern(pattern)) {
    const matcher = picomatch(pattern, { nocase: true });
    const basenameMatcher = picomatch(`**/${pattern}`, { nocase: true });
    return (value) => matcher(value) || basenameMatcher(value);
  }

  const tokens = pattern.toLowerCase().split(/\s+/).filter(Boolean);
  return (value) => {
    const normalizedValue = value.toLowerCase();
    return tokens.every((token) => normalizedValue.includes(token));
  };
}

export function isGlobPattern(pattern: string): boolean {
  return /[*?[\]{}()!+@]/.test(pattern);
}
