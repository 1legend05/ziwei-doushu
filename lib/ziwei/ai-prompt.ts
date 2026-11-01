/**
 * 命盘摘要生成与 AI 提示词
 *
 * 把 ZiweiChart 转成结构化的中文文本摘要，作为大模型的命盘上下文；
 * 同时导出解读 / 对话的系统提示词。
 */
import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { BRANCHES, STEMS } from '@/lib/ziwei/constants';
import { detectPatterns } from '@/lib/ziwei/patterns';

/** 单个星曜的描述文本 */
function starText(s: Star): string {
  const parts = [s.name];
  if (s.brightnessRaw) parts.push(s.brightnessRaw);
  if (s.siHua) parts.push(`化${s.siHua}`);
  return parts.join('·');
}

/** 单个宫位文本（精简版：保留主星亮度与四化，辅煞仅列名，控制摘要长度以加速生成） */
function palaceText(p: Palace): string {
  const stemName = STEMS[p.stem] ?? '';
  const branchName = BRANCHES[p.branch] ?? '';
  const head = `${p.name}(${stemName}${branchName})`;
  const major = p.stars.filter((s) => s.type === 'major').map(starText).join('、');
  const minor = p.stars.filter((s) => s.type !== 'major').map((s) => s.name).join('、');
  let line = head;
  if (major) line += ` ${major}`;
  if (minor) line += ` 辅:${minor}`;
  if (p.isEmpty) line += ' 空宫';
  if (p.selfSihua?.length) line += ` 自化:${p.selfSihua.map((m) => `${m.starName}化${m.siHua}`).join('、')}`;
  return line;
}

/** 把命盘转成结构化文本摘要 */
export function chartToSummary(chart: ZiweiChart): string {
  const b = chart.birthInfo;
  const l = chart.lunarInfo;
  const genderName = b.gender === 'male' ? '男' : '女';
  const hourName = BRANCHES[b.hour] ?? '';
  const lines: string[] = [];

  lines.push(`【出生信息】公历 ${b.year}年${b.month}月${b.day}日 ${hourName}时（时辰序号${b.hour}） 性别：${genderName}`);
  if (b.province || b.city) lines.push(`出生地：${b.province ?? ''}${b.city ?? ''}`);
  if (l) {
    const lunarMonth = l.isLeapMonth ? `闰${l.lunarMonth}` : l.lunarMonth;
    lines.push(
      `【农历】${l.lunarYear}年 ${lunarMonth}月${l.lunarDay}日` +
      (l.fourPillars ? ` 四柱：${l.fourPillars.join(' ')}` : ''),
    );
  }
  lines.push(`【基本盘】五行局：${chart.wuxingJuName}；命宫：${BRANCHES[chart.mingGongBranch] ?? ''}宫；身宫：${BRANCHES[chart.shenGongBranch] ?? ''}宫；命主：${chart.mingZhu ?? ''}；身主：${chart.shenZhu ?? ''}；阴阳：${chart.yinYangGender ?? ''}`);

  lines.push('');
  lines.push('【十二宫】');
  for (const p of chart.palaces) lines.push('  ' + palaceText(p));

  // 格局
  const patterns = detectPatterns(chart);
  if (patterns.length) {
    lines.push('');
    lines.push(`【格局】${patterns.map((p) => p.name).join('、')}`);
  }

  // 大限
  if (chart.daXians?.length) {
    lines.push('');
    lines.push(`【大限】当前年龄 ${chart.currentAge}，当前大限：${chart.daXians[chart.currentDaXianIndex]?.palaceName ?? ''}宫（${chart.daXians[chart.currentDaXianIndex]?.startAge ?? ''}-${chart.daXians[chart.currentDaXianIndex]?.endAge ?? ''}岁）`);
  }

  return lines.join('\n');
}

/** 解读系统提示词：紫微斗数解读大师 */
export const INTERPRET_SYSTEM_PROMPT = `你是一位精通紫微斗数的资深命理师，研习倪海厦《天纪》体系与传统紫微斗数。
用户会提供一份结构化的命盘摘要（含出生信息、农历四柱、五行局、十二宫星曜分布、格局与大限）。
请基于命盘事实进行解读，遵守以下规则：
1. 严格依据摘要中的星曜、亮度、四化、格局与大限信息展开，不得编造摘要中不存在的星曜或宫位。
2. 解读结构固定为五个小节，顺序为：【性格】【事业财运】【感情婚姻】【健康】【大限建议】，每节 2-3 句。
3. 语言通俗、客观，指出优势和需要注意的方面；不做宿命论断言，不吓唬人，措辞温和积极。
4. 总字数 300 字左右，直接输出正文，五个小节完整呈现，不省略任何一节。`;

/** 对话系统提示词：紫微斗数答疑助手 */
export const CHAT_SYSTEM_PROMPT = `你是一位精通紫微斗数的命理大师，同时懂八字、五行与传统文化。
用户会就运势、事业、感情、健康、学业等话题向你提问。
请结合传统文化知识给出有理有据、通俗易懂的回答：
1. 如果提供了用户的命盘摘要，务必先依据命盘信息作答；未提供时按一般命理知识回答，并提醒用户提供生辰信息可获得更精准的解读。
2. 回答控制在 120-150 字以内，简洁直接，口语化，适合小屏幕一屏展示，不要使用长段落。
3. 涉及健康问题仅作传统命理视角的参考提示，提醒以正规医疗为准。`;
