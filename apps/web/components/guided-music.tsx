"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyMusicQueue,
  nextMusic,
  previousMusic,
  type MusicQueue,
  type MusicTrack,
} from "../../../packages/domain/src/workout-music.ts";
import { remoteEvent } from "../lib/guided-runtime";
import type {
  RunnerEvent,
  RunnerState,
} from "../../../packages/domain/src/voice-runner.ts";
import { useLocale } from "../lib/i18n/react";

type Playlist = { id: string; name: string; ar: string; tracks: MusicTrack[] };
type Preferences = {
  playlist: string;
  shuffle: boolean;
  repeat: "off" | "playlist" | "track";
  volume: number;
  favorites: string[];
  hidden: string[];
  queue: MusicQueue;
};
const defaults: Preferences = {
  playlist: "flow",
  shuffle: true,
  repeat: "playlist",
  volume: 0.55,
  favorites: [],
  hidden: [],
  queue: emptyMusicQueue(),
};
export function GuidedMusic({
  enabled,
  ownerKey,
  state,
  title,
  target,
  duck,
  recording,
  dispatch,
}: {
  enabled: boolean;
  ownerKey: string;
  state: RunnerState;
  title: string;
  target: string;
  duck: boolean;
  recording: boolean;
  dispatch: (e: RunnerEvent) => void;
}) {
  const locale = useLocale();
  const tr = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [catalogue, setCatalogue] = useState<Playlist[]>([]),
    [error, setError] = useState("");
  const [prefs, setPrefs] = useState<Preferences>(defaults),
    [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false),
    [wanted, setWanted] = useState(false);
  const [mode, setMode] = useState<"music" | "coach">("music");
  const [checking, setChecking] = useState(false),
    [tested, setTested] = useState(false),
    [remoteAvailable, setRemoteAvailable] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const player = useRef<HTMLAudioElement>(null),
    current = useRef({ state, dispatch, mode, checking });
  current.current = { state, dispatch, mode, checking };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const lastRemote = useRef(0),
    generation = useRef(0),
    expectedPauseUntil = useRef(0);
  const storeKey = `trainer:music:${ownerKey}`;
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey) ?? "null");
      if (
        s &&
        typeof s.playlist === "string" &&
        ["off", "playlist", "track"].includes(s.repeat) &&
        typeof s.shuffle === "boolean" &&
        Number.isFinite(s.volume) &&
        Array.isArray(s.favorites) &&
        Array.isArray(s.hidden) &&
        Array.isArray(s.queue?.remaining) &&
        Array.isArray(s.queue?.played) &&
        Array.isArray(s.queue?.history)
      )
        setPrefs({ ...s, volume: Math.max(0, Math.min(1, s.volume)) });
    } catch {}
    setLoaded(true);
  }, [storeKey]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(storeKey, JSON.stringify(prefs));
      } catch {}
  }, [prefs, loaded, storeKey]);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/music", {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Music library could not be loaded.");
      setCatalogue((await response.json()).playlists);
      setError("");
    } catch {
      setError("Music library could not be loaded. Retry when connected.");
    }
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  const selected = catalogue.find((p) => p.id === prefs.playlist);
  const tracks = (selected?.tracks ?? []).filter(
    (t) =>
      !prefs.hidden.includes(t.id) &&
      (!favoritesOnly || prefs.favorites.includes(t.id)),
  );
  const ids = tracks.map((t) => t.id),
    idsRef = useRef(ids);
  idsRef.current = ids;
  const track = tracks.find((t) => t.id === prefs.queue.current);
  const move = useCallback((back = false, ended = false) => {
    const p = prefsRef.current;
    const queue = back
      ? previousMusic(p.queue, idsRef.current)
      : nextMusic(p.queue, idsRef.current, p.shuffle, p.repeat, ended);
    prefsRef.current = { ...p, queue };
    setPrefs(prefsRef.current);
    if (!queue.current) setWanted(false);
    else if (queue.current === p.queue.current && player.current) {
      player.current.currentTime = 0;
      void player.current
        .play()
        .catch(() => setError("Tap Play to resume music."));
    }
  }, []);
  const blocked =
    ["paused", "finished", "stopped"].includes(state.phase) || recording;
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    const epoch = ++generation.current;
    if (!enabled || blocked || !wanted || !track) {
      expectedPauseUntil.current = Date.now() + 1000;
      audio.pause();
      setPlaying(false);
      return;
    }
    if (audio.getAttribute("src") !== track.url) {
      expectedPauseUntil.current = Date.now() + 1000;
      audio.src = track.url;
      audio.load();
    }
    void audio
      .play()
      .then(() => {
        if (generation.current === epoch) {
          setPlaying(true);
          setError("");
        }
      })
      .catch(() => {
        if (generation.current === epoch) {
          setPlaying(false);
          setError("Playback paused. Tap Play to resume.");
        }
      });
  }, [enabled, blocked, wanted, track?.id]);
  useEffect(() => {
    if (player.current)
      player.current.volume = recording ? 0 : prefs.volume * (duck ? 0.18 : 1);
  }, [prefs.volume, duck, recording]);
  // The session owns this media session only while its own music player is enabled.
  useEffect(() => {
    if (!enabled || !("mediaSession" in navigator)) return;
    const media = navigator.mediaSession;
    const handler = (action: MediaSessionAction) => () => {
      const c = current.current;
      if (c.checking && ["nexttrack", "previoustrack"].includes(action)) {
        setTested(true);
        setChecking(false);
        return;
      }
      if (c.mode === "coach") {
        const now = performance.now();
        if (now - lastRemote.current < 1200) return;
        lastRemote.current = now;
        const event = remoteEvent(action, c.state);
        if (event) c.dispatch(event);
      } else if (action === "nexttrack") move();
      else if (action === "previoustrack") move(true);
      else setWanted(action === "play");
    };
    const registered: MediaSessionAction[] = [];
    for (const action of [
      "play",
      "pause",
      "nexttrack",
      "previoustrack",
    ] as const)
      try {
        media.setActionHandler(action, handler(action));
        registered.push(action);
      } catch {}
    setRemoteAvailable(registered.includes("nexttrack"));
    return () => {
      for (const action of registered) media.setActionHandler(action, null);
      media.metadata = null;
      media.playbackState = "none";
    };
  }, [enabled, move]);
  useEffect(() => {
    if (!enabled || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: mode === "coach" ? title : (track?.title ?? title),
      artist: mode === "coach" ? target : (selected?.name ?? "Workout music"),
      album:
        mode === "coach"
          ? tr(
              "Next: confirm · Previous: repeat",
              "التالي: تأكيد · السابق: تكرار",
            )
          : "Workout music",
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [
    enabled,
    mode,
    title,
    target,
    track?.title,
    selected?.name,
    playing,
    locale,
  ]);
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => setChecking(false), 30000);
    return () => clearTimeout(timer);
  }, [checking]);
  useEffect(() => {
    if (!enabled) {
      setMode("music");
      setChecking(false);
    }
  }, [enabled]);
  if (!enabled) return null;
  return (
    <details className="guided-music" open>
      <summary>
        {tr("Workout music", "موسيقى التمرين")}{" "}
        {track ? `· ${track.title}` : ""}
      </summary>
      <div className="stack">
        <label>
          {tr("Playlist", "قائمة التشغيل")}
          <select
            aria-label={tr("Playlist", "قائمة التشغيل")}
            value={prefs.playlist}
            onChange={(e) => {
              setPrefs({
                ...prefs,
                playlist: e.target.value,
                queue: emptyMusicQueue(),
              });
              setWanted(false);
            }}
          >
            {catalogue.map((p) => (
              <option key={p.id} value={p.id}>
                {locale === "ar" ? p.ar : p.name} · {p.tracks.length}/30
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="status">
            {tr(error, "تعذر تشغيل الموسيقى. أعد المحاولة عند الاتصال.")}{" "}
            <button className="text-button" onClick={() => void load()}>
              {tr("Retry", "إعادة المحاولة")}
            </button>
          </p>
        )}
        {!tracks.length && !error && (
          <p className="muted">
            {tr(
              "No approved tracks in this selection yet. Your guided session still works.",
              "لا توجد مقاطع معتمدة في هذا الاختيار بعد. يمكنك متابعة الجلسة.",
            )}
          </p>
        )}
        <audio
          ref={player}
          preload="metadata"
          onEnded={() => move(false, true)}
          onError={() => {
            setPlaying(false);
            setWanted(false);
            setError("Track unavailable. Choose Next or retry.");
          }}
          onPause={() => {
            setPlaying(false);
            if (
              mode === "coach" &&
              enabled &&
              wanted &&
              !blocked &&
              !player.current?.ended &&
              Date.now() > expectedPauseUntil.current
            ) {
              dispatch({ type: "command", command: { type: "pause" } });
              setError("Audio was interrupted. Resume the session when ready.");
            }
          }}
          onPlaying={() => setPlaying(true)}
        />
        <div className="button-row">
          <button
            className="button secondary"
            disabled={!prefs.queue.history.length}
            onClick={() => move(true)}
          >
            {tr("Previous song", "المقطع السابق")}
          </button>
          <button
            className="button"
            disabled={!tracks.length || blocked}
            onClick={() => {
              if (!track) move();
              setWanted(!playing);
            }}
          >
            {playing
              ? tr("Pause music", "إيقاف الموسيقى")
              : tr("Play music", "تشغيل الموسيقى")}
          </button>
          <button
            className="button secondary"
            disabled={!tracks.length}
            onClick={() => move()}
          >
            {tr("Next song", "المقطع التالي")}
          </button>
        </div>
        <div className="guided-music-options">
          <label className="voice-check">
            <input
              type="checkbox"
              checked={prefs.shuffle}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  shuffle: e.target.checked,
                  queue: { ...prefs.queue, remaining: [] },
                })
              }
            />
            {tr("Shuffle", "عشوائي")}
          </label>
          <label>
            {tr("Repeat", "تكرار")}
            <select
              aria-label={tr("Repeat", "تكرار")}
              value={prefs.repeat}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  repeat: e.target.value as Preferences["repeat"],
                })
              }
            >
              <option value="off">{tr("Off", "إيقاف")}</option>
              <option value="playlist">{tr("Playlist", "القائمة")}</option>
              <option value="track">{tr("Song", "المقطع")}</option>
            </select>
          </label>
          <label>
            {tr("Music volume", "مستوى الموسيقى")}
            <input
              aria-label={tr("Music volume", "مستوى الموسيقى")}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={prefs.volume}
              onChange={(e) =>
                setPrefs({ ...prefs, volume: Number(e.target.value) })
              }
            />
          </label>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(e) => {
                setFavoritesOnly(e.target.checked);
                setPrefs({ ...prefs, queue: emptyMusicQueue() });
                setWanted(false);
              }}
            />
            {tr("Favorites only", "المفضلة فقط")}
          </label>
        </div>
        {!!prefs.hidden.length && (
          <button
            className="text-button"
            onClick={() => setPrefs({ ...prefs, hidden: [] })}
          >
            {tr("Restore hidden songs", "إظهار المقاطع المخفية")}
          </button>
        )}
        {track && (
          <div className="button-row">
            <button
              className="button secondary"
              aria-pressed={prefs.favorites.includes(track.id)}
              onClick={() =>
                setPrefs({
                  ...prefs,
                  favorites: prefs.favorites.includes(track.id)
                    ? prefs.favorites.filter((id) => id !== track.id)
                    : [...prefs.favorites, track.id],
                })
              }
            >
              {tr("Favorite", "المفضلة")}
            </button>
            <button
              className="text-button"
              onClick={() => {
                setPrefs({
                  ...prefs,
                  hidden: [...prefs.hidden, track.id],
                  queue: { ...prefs.queue, current: null },
                });
                setWanted(false);
              }}
            >
              {tr("Hide this song", "إخفاء المقطع")}
            </button>
          </div>
        )}
        <label>
          {tr(
            "Lock-screen and headset controls",
            "أزرار شاشة القفل وسماعة الرأس",
          )}
          <select
            aria-label={tr(
              "Lock-screen and headset controls",
              "أزرار شاشة القفل وسماعة الرأس",
            )}
            value={mode}
            disabled={!remoteAvailable}
            onChange={(e) => {
              setMode(e.target.value as "music" | "coach");
              setTested(false);
            }}
          >
            <option value="music">
              {tr("Music controls", "التحكم بالموسيقى")}
            </option>
            <option value="coach">
              {tr("Coach remote", "التحكم بالجلسة")}
            </option>
          </select>
        </label>
        {mode === "coach" && (
          <div className="stack">
            <p className="muted">
              {tr(
                "Next confirms your target reps or readiness. Previous repeats the cue. Play/Pause controls the session. During rest, Next keeps the full rest. Use the app to enter fewer reps or add rest.",
                "التالي يؤكد التكرارات المستهدفة أو الجاهزية. السابق يكرر الإرشاد. التشغيل والإيقاف يتحكمان بالجلسة. لا يختصر التالي مدة الراحة. استخدم التطبيق لتسجيل تكرارات أقل أو زيادة الراحة.",
              )}
            </p>
            <button
              className="button secondary"
              disabled={!playing}
              onClick={() => setChecking(true)}
            >
              {tested
                ? tr(
                    "Remote signal received · test again",
                    "تم استقبال الإشارة · اختبر مجدداً",
                  )
                : tr("Test remote controls", "اختبار التحكم")}
            </button>
            {checking && (
              <p role="status">
                {tr(
                  "Press Next on your headset or lock screen within 30 seconds. This test will not advance your workout.",
                  "اضغط التالي في سماعة الرأس أو شاشة القفل خلال ٣٠ ثانية. لن يغير الاختبار تقدم التمرين.",
                )}
              </p>
            )}
          </div>
        )}
        <p className="muted">
          {tr(
            "Remote availability depends on your phone and headset. Test before lifting. An interruption pauses the session; return to resume if your browser suspends it.",
            "يعتمد التحكم على الهاتف والسماعة. اختبره قبل التمرين. تتوقف الجلسة عند الانقطاع؛ عد لاستئنافها إذا علقها المتصفح.",
          )}
        </p>
        {!!prefs.queue.remaining.length && (
          <details>
            <summary>{tr("Coming up", "التالي في القائمة")}</summary>
            <ol>
              {prefs.queue.remaining.slice(0, 5).map((id) => (
                <li key={id}>{tracks.find((t) => t.id === id)?.title}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </details>
  );
}
