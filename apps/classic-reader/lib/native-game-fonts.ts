export type NativeFontProfile = 'kana' | 'narcissu-3rd' | 'narcissu-10th' | 'system';

/** Derived from native EXE/font hooks and majiro.env, not a Magireco font bundle. */
export function nativeFontProfile(sourceIdentity: string | undefined): NativeFontProfile {
  const work = sourceIdentity?.split('/')[0];
  if (work === 'kana-okaeri') return 'kana';
  if (work === 'narcissu-3rd') return 'narcissu-3rd';
  if (['narcissu-himeko', 'narcissu-iris', 'narcissu-one-two', 'narcissu-sumire', 'narcissu-zero'].includes(work || '')) return 'narcissu-10th';
  return 'system';
}
