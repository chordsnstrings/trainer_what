/** Shared, instrumental music bank; no member information enters these prompts. */
export const MUSIC_PLAYLISTS = [
  {
    id: "flow",
    name: "Flow State",
    ar: "تركيز وانسياب",
    bpm: 110,
    style: "deep house, flowing ambient electronica, steady pulse, warm pads",
  },
  {
    id: "edm",
    name: "EDM Drive",
    ar: "إيقاع إلكتروني",
    bpm: 128,
    style:
      "progressive electronic dance, driving bass, crisp drums, uplifting synths",
  },
  {
    id: "rock",
    name: "Rock Strength",
    ar: "قوة الروك",
    bpm: 125,
    style:
      "instrumental rock, tight rhythm guitar, powerful drums, melodic bass",
  },
  {
    id: "rnb",
    name: "R&B Groove",
    ar: "إيقاع آر أند بي",
    bpm: 98,
    style:
      "instrumental contemporary R&B, warm electric piano, syncopated bass, smooth drums",
  },
  {
    id: "hiphop",
    name: "Hip-Hop / Trap",
    ar: "هيب هوب وتراب",
    bpm: 145,
    style:
      "instrumental hip hop and trap, halftime groove, punchy bass, detailed percussion",
  },
  {
    id: "afrolatin",
    name: "Afro / Latin Groove",
    ar: "إيقاع أفريقي ولاتيني",
    bpm: 115,
    style:
      "Afro house and Latin percussion, layered hand drums, sunny melodic groove",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    ar: "سينث ويف",
    bpm: 118,
    style: "retro synthwave, pulsing arpeggios, analogue bass, cinematic drums",
  },
  {
    id: "recovery",
    name: "Recovery",
    ar: "استشفاء",
    bpm: 75,
    style:
      "gentle downtempo, ambient textures, soft piano, relaxed steady pulse",
  },
] as const;
export const MUSIC_TARGET = 30;
export type MusicPlaylistId = (typeof MUSIC_PLAYLISTS)[number]["id"];
export type MusicTrack = {
  id: string;
  playlist: string;
  title: string;
  duration: number;
  url: string;
};
const textures = [
  "warm and spacious",
  "bright and focused",
  "minimal and rhythmic",
  "deep and rounded",
  "melodic and flowing",
  "crisp and propulsive",
];
export function musicBrief(playlist: string, index: number) {
  const p = MUSIC_PLAYLISTS.find((p) => p.id === playlist);
  if (!p || !Number.isInteger(index) || index < 0 || index >= 60)
    throw new Error("Invalid music brief");
  return {
    title: `${p.name} ${String(index + 1).padStart(2, "0")}`,
    style: `${p.style}; ${textures[index % textures.length]}; ${p.bpm + ((index % 5) - 2) * 2} BPM; workout accompaniment; instrumental only, no vocals or speech; consistent energy; clean beginning and ending; avoid sudden volume jumps`,
    duration: 240,
  };
}

export type MusicQueue = {
  current: string | null;
  remaining: string[];
  history: string[];
  played: string[];
};
export const emptyMusicQueue = (): MusicQueue => ({
  current: null,
  remaining: [],
  history: [],
  played: [],
});
export function shuffled(ids: string[], random = Math.random) {
  const result = [...new Set(ids)];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
/** Every available song is heard once before reshuffling. Manual skips count as heard. */
export function nextMusic(
  q: MusicQueue,
  ids: string[],
  shuffle: boolean,
  repeat: "off" | "playlist" | "track",
  ended = false,
  random = Math.random,
): MusicQueue {
  const allowed = [...new Set(ids)];
  if (ended && repeat === "track" && q.current && allowed.includes(q.current))
    return q;
  const played = q.played.filter((id) => allowed.includes(id));
  let remaining = q.remaining.filter(
    (id) => allowed.includes(id) && !played.includes(id),
  );
  if (!remaining.length) {
    const unseen = allowed.filter((id) => !played.includes(id));
    if (!unseen.length && repeat === "off")
      return { ...q, current: null, remaining: [] };
    const pool = unseen.length ? unseen : allowed;
    remaining = shuffle ? shuffled(pool, random) : pool;
    if (!unseen.length) played.length = 0;
    if (remaining.length > 1 && remaining[0] === q.current)
      remaining.push(remaining.shift()!);
  }
  const current = remaining.shift() ?? null;
  return {
    current,
    remaining,
    history: [...q.history, ...(q.current ? [q.current] : [])].slice(-300),
    played: [...played, ...(current ? [current] : [])],
  };
}
export function previousMusic(q: MusicQueue, ids: string[]): MusicQueue {
  const history = q.history.filter((id) => ids.includes(id));
  const current = history.pop();
  return current
    ? {
        ...q,
        current,
        history,
        remaining: [...(q.current ? [q.current] : []), ...q.remaining].filter(
          (id) => id !== current,
        ),
        played: q.played.filter((id) => id !== q.current),
      }
    : q;
}
