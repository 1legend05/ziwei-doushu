/**
 * POST /api/screen — 接收圆屏 LVGL 快照（RGB565 RAW，466×466×2=434KB）
 * 调试用：把设备真实屏幕内容回传。
 *
 * ★ Vercel 兼容（2026-11-01）：无持久文件系统，改内存环形存储，只保留最近 50 张。
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

/** 内存环形存储：{ ts -> Buffer }，仅保留最近 50 张 */
const ring = new Map<number, Buffer>();
const KEEP = 50;

export async function POST(req: NextRequest) {
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length < 1000) {
      return NextResponse.json({ ok: false, error: '数据过小' }, { status: 400 });
    }
    const ts = Date.now();
    ring.set(ts, buf);
    while (ring.size > KEEP) {
      const oldest = ring.keys().next().value as number;
      ring.delete(oldest);
    }
    return NextResponse.json({ ok: true, file: `screen_${ts}.raw`, bytes: buf.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** GET /api/screen — 调试：列出最近快照时间戳 */
export async function GET() {
  const list = Array.from(ring.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([ts, b]) => ({ ts, bytes: b.length }));
  return NextResponse.json({ ok: true, count: list.length, screens: list.slice(0, 10) });
}
