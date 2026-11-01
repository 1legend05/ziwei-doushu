/**
 * POST /api/ai/interpret
 *
 * 排盘 + AI 解读：
 *   body: { year, month, day, hour, gender, province?, city? }
 *   hour: 时辰序号 0-11（子=0 ... 亥=11）
 *   gender: 'male' | 'female'
 *
 *  返回: { ok, summary, text }
 *   - summary: 结构化命盘摘要（供展示）
 *   - text:    AI 解读全文
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateChart } from '@/lib/ziwei/algorithm';
import { chartToSummary, INTERPRET_SYSTEM_PROMPT } from '@/lib/ziwei/ai-prompt';
import { arkChat } from '@/lib/ai/ark';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 JSON' }, { status: 400 });
  }

  const year = Number(body.year);
  const month = Number(body.month);
  const day = Number(body.day);
  const hour = Number(body.hour);
  const gender = body.gender as string;
  const province = typeof body.province === 'string' ? body.province : undefined;
  const city = typeof body.city === 'string' ? body.city : undefined;

  if (
    !Number.isInteger(year) || year < 1900 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > 31 ||
    !Number.isInteger(hour) || hour < 0 || hour > 11 ||
    (gender !== 'male' && gender !== 'female')
  ) {
    return NextResponse.json({ ok: false, error: '参数不合法：year/month/day/hour/gender' }, { status: 400 });
  }

  try {
    const chart = generateChart({ year, month, day, hour, gender, province, city });
    const summary = chartToSummary(chart);

    const text = await arkChat(
      [
        { role: 'system', content: INTERPRET_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `请为这位${gender === 'male' ? '男性' : '女性'}用户撰写紫微斗数解读（100字以内，圆屏一屏展示）：\n\n${summary}`,
        },
      ],
      // 排盘解读用 lite 模型提速（pro 对长命理任务推理过慢，>60s）
      { model: process.env.ARK_ASR_MODEL, maxTokens: 300 },
    );

    return NextResponse.json({ ok: true, summary, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
