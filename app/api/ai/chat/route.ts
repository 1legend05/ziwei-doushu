/**
 * POST /api/ai/chat
 *
 * 多轮对话（紫微斗数答疑）：
 *   body: {
 *     messages: [{ role: 'user'|'assistant', content: string }],
 *     summary?: string   // 可选，命盘摘要上下文（首次对话时可携带）
 *   }
 *
 *  返回: { ok, reply }
 *
 * ★ 2026-11-01 新增：无命盘时，若用户消息中含出生信息（年/月/日/时/性别），
 *   自动转入排盘解读流程（与 voice-interpret 同口径），不再只让 AI 引导——
 *   设备上无论走"语音排盘"按钮还是普通录音提问，说出出生信息都能出盘。
 *   多轮补全：合并最近 5 条 user 消息解析，跨轮字段累计；回复会由固件写入历史，
 *   因此下一轮补充的信息能与上一轮合并。
 */
import { NextRequest, NextResponse } from 'next/server';
import { CHAT_SYSTEM_PROMPT, INTERPRET_SYSTEM_PROMPT } from '@/lib/ziwei/ai-prompt';
import { arkChat, type ChatMsg } from '@/lib/ai/ark';
import { generateChart } from '@/lib/ziwei/algorithm';
import { chartToSummary } from '@/lib/ziwei/ai-prompt';
import { parseBirth, mergeBirth, applyLunar, type ParsedBirth } from '@/lib/ziwei/parse-birth';

const REQUIRED: Array<[keyof ParsedBirth, string]> = [
  ['year', '出生年份'],
  ['month', '出生月份'],
  ['day', '出生日期'],
  ['hour', '出生时辰'],
  ['gender', '性别'],
];

/** 已收集摘要（与 voice-interpret 同格式） */
function birthGotText(birth: ParsedBirth): string {
  const HOUR_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  return REQUIRED
    .filter(([k]) => birth[k] !== undefined)
    .map(([k]) => {
      const v = birth[k] as number | 'male' | 'female';
      if (k === 'gender') return v === 'male' ? '男' : '女';
      if (k === 'year') return `${v}年`;
      if (k === 'month') return `${v}月`;
      if (k === 'day') return `${v}日`;
      if (k === 'hour') return `${HOUR_NAMES[v as number] ?? v}时`;
      return '';
    })
    .join('、');
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是 JSON' }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMsg[] = rawMessages.slice(-20).map((m) => {
    const mm = m as { role?: string; content?: string };
    const role = mm.role === 'assistant' ? 'assistant' : 'user';
    return { role, content: String(mm.content ?? '').slice(0, 2000) };
  });
  if (!messages.length) {
    return NextResponse.json({ ok: false, error: 'messages 不能为空' }, { status: 400 });
  }

  const summary = typeof body.summary === 'string' ? body.summary.slice(0, 8000) : undefined;

  // ── 出生信息自动排盘：仅当还没有命盘时尝试解析 ──
  if (!summary) {
    const recentUser = messages
      .filter((m) => m.role === 'user')
      .slice(-5)
      .map((m) => m.content)
      .join('，');
    const parsed = parseBirth(recentUser) ?? {};
    const hasBirth = (Object.keys(parsed) as Array<keyof ParsedBirth>).some(
      (k) => parsed[k] !== undefined,
    );
    if (hasBirth) {
      const birth = applyLunar(parsed);
      const missing = REQUIRED.filter(([k]) => birth[k] === undefined).map(([, label]) => label);
      if (missing.length > 0) {
        // 信息不全 → 追问（固件会把本回复写入历史，下一轮补充可与本轮合并）
        return NextResponse.json({
          ok: true,
          reply: `已收到：${birthGotText(birth)}。还缺少${missing.join('、')}，请补充`,
        });
      }
      const year = birth.year as number;
      const month = birth.month as number;
      const day = birth.day as number;
      const hour = birth.hour as number;
      const gender = birth.gender as 'male' | 'female';
      try {
        const chart = generateChart({ year, month, day, hour, gender });
        const chartSummary = chartToSummary(chart);
        const textOut = await arkChat(
          [
            { role: 'system', content: INTERPRET_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `请为这位${gender === 'male' ? '男性' : '女性'}用户撰写紫微斗数完整解读，全文控制在500字以内，按【性格】【事业财运】【感情婚姻】【健康】【大限建议】五个小节完整输出，每节约80~100字：\n\n${chartSummary}`,
            },
          ],
          { model: process.env.ARK_ASR_MODEL, maxTokens: 900 },
        );
        return NextResponse.json({
          ok: true,
          reply: textOut,
          summary: chartSummary,
          birth: { year, month, day, hour, gender, lunar: birth.lunar },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }
  }

  // ── 常规对话（已有命盘 / 未涉及出生信息）──
  try {
    const system: ChatMsg = { role: 'system', content: CHAT_SYSTEM_PROMPT };
    const context: ChatMsg[] = summary
      ? [{ role: 'user', content: `【用户的命盘摘要】\n${summary}\n\n请在回答时优先依据该命盘信息。` }]
      : [];

    const reply = await arkChat([system, ...context, ...messages], {
      // 圆屏问答用 lite 模型：pro 对带命盘摘要的对话推理过慢（>100s）
      model: process.env.ARK_ASR_MODEL,
      maxTokens: 300,
    });
    return NextResponse.json({ ok: true, reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
