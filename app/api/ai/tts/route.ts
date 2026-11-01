/**
 * GET|POST /api/ai/tts
 *
 * 语音合成（免 API Key）：edge-tts(微软免费语音) + PyAV 解码，输出 16kHz/16bit/单声道 WAV。
 *   - GET  /api/ai/tts?text=xxx
 *   - POST body: { "text": "xxx" }
 *
 *  返回: audio/wav（可直接写入文件播放）
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_TEXT = 500;

async function synth(text: string): Promise<{ buf: Buffer; type: string }> {
  const id = randomUUID();
  const wavPath = join(tmpdir(), `ziwei-tts-${id}.wav`);
  const script = join(process.cwd(), 'scripts', 'tts.py');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('python', [script, text, wavPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (d) => {
        err += d.toString();
        if (err.length > 500) err = err.slice(-500);
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('TTS 超时'));
      }, 50000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(err.trim() || `TTS 失败(code=${code})`));
      });
    });
    const buf = await readFile(wavPath);
    return { buf, type: 'audio/wav' };
  } finally {
    unlink(wavPath).catch(() => {});
  }
}

async function handle(text: string) {
  if (!text || !text.trim()) {
    return NextResponse.json({ ok: false, error: '缺少 text 参数' }, { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT);
  }
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
