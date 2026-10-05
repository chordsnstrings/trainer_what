import { integrationRequest } from "./integrations.ts";
import { runtimeConfig, type RuntimeConfig } from "./configuration.ts";
import { musicBrief } from "../../domain/src/workout-music.ts";
const ROOT = "https://apibox.erweima.ai/api/v1";
export class MusicProviderError extends Error {
  constructor(
    public outcome: "definitive" | "unknown",
    message: string,
  ) {
    super(message);
  }
}
async function request(
  path: string,
  body?: unknown,
  config: RuntimeConfig = runtimeConfig(),
) {
  if (!config.MUSIC_API_KEY)
    throw new MusicProviderError(
      "definitive",
      "Add the music API key in protected settings.",
    );
  let response: Response;
  try {
    response = await integrationRequest(ROOT + path, {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${config.MUSIC_API_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new MusicProviderError(
      "unknown",
      "Music provider response is unknown; reconcile before retrying.",
    );
  }
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || payload?.code !== 200) {
    const code = Number(payload?.code ?? response.status);
    throw new MusicProviderError(
      [400, 401, 402, 403, 404, 413, 422, 429].includes(code)
        ? "definitive"
        : "unknown",
      `Music provider returned code ${code}.`,
    );
  }
  return payload.data;
}
export async function musicCredits(config?: RuntimeConfig): Promise<number> {
  const credits = Number(await request("/generate/credit", undefined, config));
  if (!Number.isFinite(credits) || credits < 0)
    throw new MusicProviderError(
      "unknown",
      "The provider credit balance was invalid.",
    );
  return credits;
}
export async function generateMusic(playlist: string, index: number) {
  const config = runtimeConfig();
  if (config.MUSIC_ENABLED !== "true")
    throw new MusicProviderError("definitive", "Music generation is disabled.");
  const model = config.MUSIC_MODEL ?? "V6";
  if (!["V6", "V6_MINI", "V6_WILD"].includes(model))
    throw new MusicProviderError(
      "definitive",
      "Select a supported music model in settings.",
    );
  const brief = musicBrief(playlist, index);
  const data = await request("/generate", {
    ...brief,
    customMode: true,
    instrumental: true,
    negativeTags:
      "vocals, singing, speech, lyrics, spoken word, crowd chanting, clipping, abrupt silence",
    model,
    variety: 1,
    callBackUrl: new URL("/api/v1/public/music/callback", config.PUBLIC_APP_URL)
      .href,
  });
  if (
    typeof data?.taskId !== "string" ||
    !data.taskId ||
    data.taskId.length > 200
  )
    throw new MusicProviderError(
      "unknown",
      "The generation task identifier was missing.",
    );
  return data.taskId as string;
}
export type GeneratedMusic = {
  id: string;
  url: string;
  title: string;
  duration: number;
};
export async function musicResult(
  taskId: string,
): Promise<{
  status: "pending" | "complete" | "failed";
  tracks: GeneratedMusic[];
  instrumental: boolean;
  title: string;
}> {
  const data = await request(
    "/generate/record-info?taskId=" + encodeURIComponent(taskId),
  );
  if (data?.taskId !== taskId)
    throw new MusicProviderError("unknown", "The music task does not match.");
  let params: any = null;
  try {
    params =
      typeof data.param === "string" ? JSON.parse(data.param) : data.param;
  } catch {}
  const source = {
    instrumental: params?.instrumental === true,
    title: String(params?.title ?? ""),
  };
  if (data.status === "SUCCESS") {
    const tracks = data.response?.sunoData;
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 4)
      throw new MusicProviderError("unknown", "Invalid music outputs.");
    return {
      ...source,
      status: "complete",
      tracks: tracks.map((t: any) => {
        if (
          typeof t.id !== "string" ||
          t.id.length > 200 ||
          !Number.isFinite(t.duration) ||
          t.duration < 150 ||
          t.duration > 360 ||
          typeof t.audio_url !== "string"
        )
          throw new MusicProviderError(
            "definitive",
            "A track failed the duration or file checks.",
          );
        return {
          id: t.id,
          url: t.audio_url,
          title: String(t.title ?? "Instrumental").slice(0, 100),
          duration: t.duration,
        };
      }),
    };
  }
  return {
    ...source,
    status: /FAIL|ERROR|SENSITIVE/.test(String(data?.status))
      ? "failed"
      : "pending",
    tracks: [],
  };
}
/** providerRequest validates public HTTPS and pins DNS; redirects are refused. */
export async function downloadMusic(url: string): Promise<Buffer> {
  const response = await integrationRequest(
    url,
    { signal: AbortSignal.timeout(45000) },
    undefined,
    20 * 1024 * 1024,
  );
  if (
    !response.ok ||
    !/^(audio\/(mpeg|mp3)|application\/octet-stream)(;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new MusicProviderError(
      "definitive",
      "The generated file is not MP3 audio.",
    );
  const limit = 20 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit || !response.body)
    throw new MusicProviderError(
      "definitive",
      "Music file exceeds the storage limit.",
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit)
        throw new MusicProviderError(
          "definitive",
          "Music file exceeds the storage limit.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buffer = Buffer.concat(chunks);
  if (
    buffer.length < 1024 ||
    !(
      buffer.subarray(0, 3).toString() === "ID3" ||
      (buffer[0] === 255 && (buffer[1] & 224) === 224)
    )
  )
    throw new MusicProviderError("definitive", "Invalid MP3 header.");
  return buffer;
}
