/**
 * POST /api/ai/voice-interpret
 *
 * 语音排盘（支持多轮补全出生信息）：
 *   body: { text, partial? }  例："一九九零年五月十五日寅时男"；partial 为上一轮返回的 birth
 *
 * 返回：
 *   - 信息不全: { ok: true, complete: false, birth: {...已收集}, ask: "还缺少…请补充" }
 *   - 信息齐全: { ok: true, complete: true, summary, text, birth }
 *   - 出错:     { ok: false, error }
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateChart } from '@/lib/ziwei/algorithm';
import { chartToSummary, INTERPRET_SYSTEM_PROMPT } from '@/lib/ziwei/ai-prompt';
import { arkChat } from '@/lib/ai/ark';
import { parseBirth, mergeBirth, applyLunar, type ParsedBirth } from '@/lib/ziwei/parse-birth';

const REQUIRED: Array<[keyof ParsedBirth, string]> = [
  ['year', '出生年份'],
  ['month', '出生月份'],
  ['day', '出生日期'],
  ['hour', '出生时辰'],
  ['gender', '性别'],
];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 JSON' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  // 上一轮已收集的出生信息（固件原样回传）
  const prev = (typeof body.partial === 'object' && body.partial !== null ? body.partial : {}) as ParsedBirth;

  const parsed = parseBirth(text) ?? {};
  const birth = applyLunar(mergeBirth(parsed, prev));

  // 本轮是否解析出任何新信息（防止"没听清"时重复追问死循环）
  const fresh = (Object.keys(parsed) as Array<keyof ParsedBirth>).filter(
    (k) => parsed[k] !== undefined,
  );
  if (fresh.length === 0) {
    return NextResponse.json({
      ok: true,
      complete: false,
      birth,
      ask: '没听清，请重新说一下出生年月日、出生时间或性别',
    });
  }

  // 完整性检查：缺一项就追问（补齐后才排盘），并播报已收集摘要让用户确认听到了什么
  const missing = REQUIRED.filter(([k]) => birth[k] === undefined).map(([, label]) => label);
  if (missing.length > 0) {
    const HOUR_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    const got = REQUIRED.filter(([k]) => birth[k] !== undefined).map(([k]) => {
      const v = birth[k] as number | 'male' | 'female';
      if (k === 'gender') return v === 'male' ? '男' : '女';
      if (k === 'year') return `${v}年`;
      if (k === 'month') return `${v}月`;
      if (k === 'day') return `${v}日`;
      if (k === 'hour') return `${HOUR_NAMES[v as number] ?? v}时`;
      return '';
    });
    return NextResponse.json({
      ok: true,
      complete: false,
      birth,
      ask: `已收到：${got.join('、')}。还缺少${missing.join('、')}，请补充`,
    });
  }

  const year = birth.year as number;
  const month = birth.month as number;
  const day = birth.day as number;
  const hour = birth.hour as number;
  const gender = birth.gender as 'male' | 'female';

  try {
    const chart = generateChart({ year, month, day, hour, gender });
    const summary = chartToSummary(chart);

    const textOut = await arkChat(
      [
        { role: 'system', content: INTERPRET_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `请为这位${gender === 'male' ? '男性' : '女性'}用户撰写紫微斗数完整解读，全文控制在500字以内，按【性格】【事业财运】【感情婚姻】【健康】【大限建议】五个小节完整输出，每节约80~100字：\n\n${summary}`,
        },
      ],
      { model: process.env.ARK_ASR_MODEL, maxTokens: 900 },
    );

    return NextResponse.json({ ok: true, complete: true, summary, text: textOut, birth: { year, month, day, hour, gender, lunar: birth.lunar } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
