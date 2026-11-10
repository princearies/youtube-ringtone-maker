import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'
import { run } from './proc.mjs'
import { AppError } from './security.mjs'

const PEAK_SAMPLE_RATE = 8_000
const PEAK_BUCKETS = 720

/** ffprobe → normalised audio facts. */
export async function probeAudio(file) {
  let parsed
  try {
    const { stdout } = await run(
      config.bin.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30_000, maxBytes: 4 << 20 },
    )
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new AppError('UNREADABLE_AUDIO', 'That audio could not be read.', 422, { cause: err })
  }

  const stream = (parsed.streams || []).find((s) => s.codec_type === 'audio')
  const duration = Number(parsed.format?.duration ?? stream?.duration ?? 0)

  if (!stream) throw new AppError('NO_AUDIO_TRACK', 'That video has no audio track.', 422)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AppError('UNREADABLE_AUDIO', 'That audio has no usable duration.', 422)
  }

  return {
    duration: Number(duration.toFixed(3)),
    codec: stream.codec_name || 'unknown',
    sampleRate: Number(stream.sample_rate || 0),
    channels: Number(stream.channels || 0),
    formatName: parsed.format?.format_name || '',
  }
}

/**
 * Trim + encode. Re-encodes (never stream-copies) so the cut lands on the
 * exact requested millisecond and the result is a standard ringtone file.
 */
export async function renderClip({ input, output, start, end, format }) {
  const duration = Math.max(0.3, end - start)
  const fadeOutAt = Math.max(0, duration - 0.04)

  const filters = [`afade=t=in:st=0:d=0.03`, `afade=t=out:st=${fadeOutAt.toFixed(3)}:d=0.04`]
  if (config.normalize) filters.unshift('loudnorm=I=-16:TP=-1.5:LRA=11')

  const head = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    // -ss before -i: fast seek. ffmpeg's accurate_seek (default when
    // re-encoding) restores frame accuracy, so the cut is sample-tight.
    '-ss', start.toFixed(3),
    '-to', end.toFixed(3),
    '-i', input,
    '-vn', '-map', '0:a:0',
    '-af', filters.join(','),
    '-ac', '1', '-ar', '44100',
  ]

  const tail = format === 'm4r'
    ? ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'ipod', output]
    : ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3', '-write_id3v1', '1', '-f', 'mp3', output]

  try {
    await run(config.bin.ffmpeg, [...head, ...tail], { timeout: config.renderTimeoutMs, maxBytes: 2 << 20 })
  } catch (err) {
    throw new AppError('RENDER_FAILED', 'The ringtone could not be encoded.', 500, { cause: err })
  }

  const stat = await fs.stat(output)
  if (stat.size < 1024) throw new AppError('RENDER_FAILED', 'The rendered file came out empty.', 500)
  return { bytes: stat.size }
}

/**
 * Browsers seek reliably only in MP4/AAC. Prefer YouTube's m4a stream; if the
 * video only offers Opus/WebM, transcode once so preview + waveform work everywhere.
 */
export async function ensurePlayableAudio(file, dir) {
  const facts = await probeAudio(file)

  if (facts.codec === 'aac' && /m4a|mp4/.test(facts.formatName)) {
    return { file, contentType: 'audio/mp4', transcoded: false, facts }
  }

  const target = path.join(dir, 'preview.m4a')
  try {
    await run(config.bin.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', file, '-vn', '-map', '0:a:0',
      '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart', '-f', 'ipod', target,
    ], { timeout: config.renderTimeoutMs, maxBytes: 2 << 20 })
  } catch (err) {
    throw new AppError('CONVERT_FAILED', 'That audio format could not be converted.', 500, { cause: err })
  }

  return { file: target, contentType: 'audio/mp4', transcoded: true, facts: await probeAudio(target) }
}

/**
 * Peak envelope for the waveform: decode to 8 kHz mono PCM and keep the max
 * absolute sample per bucket. Cheap (no full-rate decode) and deterministic.
 */
export async function computePeaks(file, buckets = PEAK_BUCKETS) {
  let pcm
  try {
    const result = await run(config.bin.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
      '-vn', '-ac', '1', '-ar', String(PEAK_SAMPLE_RATE),
      '-f', 's16le', '-acodec', 'pcm_s16le', '-',
    ], { timeout: 60_000, maxBytes: 96 << 20, binary: true })
    pcm = result.stdout
  } catch {
    return []
  }

  const sampleCount = Math.floor(pcm.length / 2)
  if (sampleCount < 64) return []

  const size = Math.max(1, Math.ceil(sampleCount / buckets))
  const peaks = []
  let offset = 0

  for (let index = 0; index < buckets; index += 1) {
    const limit = Math.min(sampleCount, offset + size)
    let peak = 0
    for (let i = offset; i < limit; i += 1) {
      const value = Math.abs(pcm.readInt16LE(i * 2))
      if (value > peak) peak = value
    }
    peaks.push(Number(Math.min(1, Math.sqrt(peak / 32768)).toFixed(3)))
    offset = limit
    if (offset >= sampleCount) break
  }

  return peaks
}
