export function isUsableCloseCents(cents: number | null): cents is number {
  return cents !== null && Number.isFinite(cents) && cents > 0;
}

export function usableCloseCents(price: string | null): number | null {
  if (price === null) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
  if (!match?.[1]) return null;
  const cents = Number(match[1]) * 100 + Number(((match[2] ?? '') + '00').slice(0, 2));
  return isUsableCloseCents(cents) ? cents : null;
}
