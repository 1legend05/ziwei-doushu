/**
 * POST /api/ai/asr
 *
 * 语音识别：上传音频（multipart/form-data，字段名 file），返回识别文本。
 *   - 支持 wav/pcm(16kHz,16bit,mono) 等格式（方舟豆包 ASR 要求 pcm_s16le）
 *
 *  返回: { ok, text }
 */
import { NextRequest, NextResponse } from 'next/server';
import { arkTranscribe } from '@/lib/ai/ark';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ ok: false, error: '缺少 file 字段' }, { status: 400 });
  }

  const mime = file.type || 'audio/wav';
  const name = file.name || 'audio.wav';
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 44) {
      return NextResponse.json({ ok: false, error: '音频文件过小或格式不支持' }, { status: 400 });
    }
    // 上限保护：正常录音 60s≈1.9MB；超过 6MB 视为异常/恶意上传，避免大文件拖垮内存
    if (buf.length > 6 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: '音频文件过大（上限 6MB）' }, { status: 413 });
    }
    const text = await arkTranscribe(buf, name, mime);
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
