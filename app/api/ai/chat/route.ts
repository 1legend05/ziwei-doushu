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
 */
import { NextRequest, NextResponse } from 'next/server';
import { CHAT_SYSTEM_PROMPT } from '@/lib/ziwei/ai-prompt';
import { arkChat, type ChatMsg } from '@/lib/ai/ark';

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
