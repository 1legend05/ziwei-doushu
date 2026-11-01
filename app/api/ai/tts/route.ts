/**
 * GET|POST /api/ai/tts
 *
 * 语音合成（纯 Node 实现，Vercel/本地通用）：
 *   msedge-tts（微软 Edge 免费语音，免 API Key）→ mp3 → mpg123-decoder(WASM) 解码
 *   → 重采样 16kHz → 16bit/单声道 WAV。
 *   - GET  /api/ai/tts?text=xxx
 *   - POST body: { "text": "xxx" }
 *  返回: audio/wav（可直接写入文件播放）
 */
import { NextRequest, NextResponse } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { MPEGDecoder } from 'mpg123-decoder';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_TEXT = 500;
const VOICE = 'zh-CN-XiaoxiaoNeural'; // 晓晓女声（与旧 python 版一致）
const SRC_RATE = 24000; // edge 默认输出 24kHz mp3
const TARGET_RATE = 16000;

/** mp3 → Float32 单声道 PCM + 采样率 */
async function decodeMp3(mp3: Uint8Array): Promise<{ pcm: Float32Array; rate: number }> {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const out = decoder.decode(mp3);
    if (!out || !out.channelData?.length || !out.samplesDecoded) {
      throw new Error('mp3 解码无输出');
    }
    // 取左声道（edge 输出为单声道/双声道）
    const ch = out.channelData[0];
    const pcm = new Float32Array(out.samplesDecoded);
    for (let i = 0; i < out.samplesDecoded; i++) pcm[i] = ch[i];
    return { pcm, rate: out.sampleRate || SRC_RATE };
  } finally {
    decoder.free();
  }
}

/** 线性重采样 */
function resample(pcm: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return pcm;
  const n = Math.round((pcm.length * dstRate) / srcRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * pcm.length) / n;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

/** Float32 → int16 WAV buffer */
function pcmToWav(pcm: Float32Array, rate: number): Buffer {
  const n = pcm.length;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, pcm[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function synth(text: string): Promise<{ buf: Buffer; type: string }> {
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: 45000 });
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Uint8Array[] = [];
    for await (const c of audioStream) {
      chunks.push(c instanceof Uint8Array ? c : Uint8Array.from(c));
    }
    const mp3 = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      mp3.set(c, off);
      off += c.length;
    }
    if (off < 100) throw new Error('TTS 音频过短');
    const { pcm, rate } = await decodeMp3(mp3);
    const mono = resample(pcm, rate, TARGET_RATE);
    const wav = pcmToWav(mono, TARGET_RATE);
    return { buf: wav, type: 'audio/wav' };
  } finally {
    tts.close();
  }
}

async function handle(text: string) {
  if (!text || !text.trim()) {
    return NextResponse.json({ ok: false, error: '缺少 text 参数' }, { status: 400 });
  }
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
  try {
    const { buf } = await synth(text);
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get('text') || '');
}

export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    return handle(typeof j?.text === 'string' ? j.text : '');
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 JSON {text}' }, { status: 400 });
  }
}
