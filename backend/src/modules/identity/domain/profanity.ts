const DENYLIST = Object.freeze([
  'bitch',
  'cunt',
  'dick',
  'faggot',
  'fuck',
  'hitler',
  'nazi',
  'nigga',
  'nigger',
  'penis',
  'shit',
  'slut',
  'whore',
] as const);

const LEET_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  '!': 'i',
  $: 's',
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
});

export function normalizeForProfanity(value: string): string {
  return Array.from(value.normalize('NFKD').toLowerCase())
    .map((character) => LEET_CHARACTERS[character] ?? character)
    .join('')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z]/g, '');
}

export function containsProfanity(value: string): boolean {
  const normalized = normalizeForProfanity(value);
  return DENYLIST.some((blocked) => normalized.includes(blocked));
}
