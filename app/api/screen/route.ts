/**
 * POST /api/screen — 接收圆屏 LVGL 快照（RGB565 RAW，466×466×2=434KB）
 * 调试用：把设备真实屏幕内容回传，保存到 public/screens/screen_<ts>.raw
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const buf = await req.arrayBuffer();
    const data = Buffer.from(buf);
    if (data.length < 1000) {
      return NextResponse.json({ ok: false, error: '数据过小' }, { status: 400 });
    }
    const dir = path.join(process.cwd(), 'public', 'screens');
    fs.mkdirSync(dir, { recursive: true });
    const name = `screen_${Date.now()}.raw`;
    fs.writeFileSync(path.join(dir, name), data);
    // 磁盘清理：每张约 434KB，只保留最近 50 张，超出删除最旧（防 2GB+ 膨胀）
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.raw')).sort();
      while (files.length > 50) {
        const old = files.shift() as string;
        fs.unlinkSync(path.join(dir, old));
      }
    } catch {
      // 清理失败不影响上传结果（仅日志）
    }
    return NextResponse.json({ ok: true, file: name, bytes: data.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
