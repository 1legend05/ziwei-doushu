/**
 * 火山方舟（豆包大模型）接入模块
 *
 * 统一封装方舟 OpenAI 兼容接口：
 *  - POST {base}/chat/completions   多轮对话
 *  - POST {base}/chat/completions + input_audio   语音识别（SpeechToText，需支持 SpeechToText 的模型如 doubao-seed-2-1-lite-260915）
 *
 * 环境变量（.env.local）：
 *  - ARK_API_KEY      方舟 API Key（必填）
 *  - ARK_BASE_URL     默认 https://ark.cn-beijing.volces.com/api/v3
 *  - ARK_MODEL        对话模型 ID（如 doubao-seed-2-1-pro-260915，或控制台创建的推理接入点 ep-xxx）
 *  - ARK_ASR_MODEL    语音识别模型 ID（如 doubao-seed-2-1-lite-260915，支持 SpeechToText）
 */

const ARK_BASE = process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 多轮对话，返回模型回复文本 */
export async function arkChat(
  messages: ChatMsg[],
  opts?: { model?: string; maxTokens?: number },
): Promise<string> {
  const key = process.env.ARK_API_KEY;
  if (!key) throw new Error('未配置 ARK_API_KEY（请在 .env.local 中填入火山方舟 API Key）');
  const model = opts?.model ?? process.env.ARK_MODEL;
  if (!model) throw new Error('未配置 ARK_MODEL（请在 .env.local 中填入方舟模型 ID）');

  const res = await fetch(`${ARK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: opts?.maxTokens ?? 1600,
    }),
  });

  if (!res.ok) {
    const t = (await res.text()).slice(0, 400);
    throw new Error(`方舟对话接口 ${res.status}: ${t}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * 语音识别（SpeechToText）：把音频 base64 作为 input_audio 发给支持 SpeechToText 的模型，
 * 返回转写文本。方舟的 /audio/transcriptions 端点仅限专门 ASR 模型；
 * doubao-seed-2-1-lite-260915 这类多模态模型走 chat/completions + input_audio。
 */
export async function arkTranscribe(file: Buffer, _filename: string, mime: string): Promise<string> {
  const key = process.env.ARK_API_KEY;
  if (!key) throw new Error('未配置 ARK_API_KEY');
  const model = process.env.ARK_ASR_MODEL;
  if (!model) throw new Error('未配置 ARK_ASR_MODEL');

  const fmt = mime.includes('pcm') ? 'pcm' : mime.includes('mp3') ? 'mp3' : 'wav';
  const dataUrl = file.toString('base64');

  const res = await fetch(`${ARK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: dataUrl, format: fmt } },
            { type: 'text', text: '请将这段音频中的语音内容逐字转写为文字。只输出转写结果本身，不要任何解释、前缀或标点加工。若音频中没有人声，则返回空字符串。' },
          ],
        },
      ],
      stream: false,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const t = (await res.text()).slice(0, 400);
    throw new Error(`方舟语音识别 ${res.status}: ${t}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? '';
}
