/**
 * 从语音识别文本中解析出生信息（支持多轮补全：每轮只解析本轮出现的新字段，缺省字段不设）
 * 支持中文数字与阿拉伯数字混合：
 *   例："一九九零年五月十五日寅时男" / "1990年5月15日寅时 男" / "九零年腊月廿五 女"
 * 历法规则：默认按公历（阳历）；仅当明确说出“农历/阴历”等字样时标记 lunar，
 *   由 mergeBirth/applyLunar 在信息补全后统一换算为公历（标记跨轮保留）。
 * 返回: { year?, month?, day?, hour?, gender?, lunar? }（不会因缺年份返回 null）
 */

import { Lunar } from 'lunar-javascript';

const LUNAR_MARK = /(农历|阴历|老历|旧历|夏历)/;

const CN_DIGITS: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '廿': 2, '卅': 3,
};
const CN_TENS = ['', '十', '百', '千', '万'];
const HOURS: Record<string, number> = {
  '子': 0, '丑': 1, '寅': 2, '卯': 3, '辰': 4, '巳': 5,
  '午': 6, '未': 7, '申': 8, '酉': 9, '戌': 10, '亥': 11,
};

function cnNumToInt(s: string): number | null {
  if (!s) return null;
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  // 纯中文数字 → 数字（支持 一九九零=1990、十五=15、二十一=21）
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '十') {
      total = (total === 0 && cur === 0 ? 1 : total) * 10;
      cur = 0;
    } else if (ch in CN_DIGITS) {
      cur = cur * 10 + CN_DIGITS[ch];
    } else if (ch === '百') {
      total += cur * 100; cur = 0;
    } else if (ch === '千') {
      total += cur * 1000; cur = 0;
    } else {
      return null;
    }
  }
  total += cur;
  return total;
}

export interface ParsedBirth {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  gender?: 'male' | 'female';
  lunar?: boolean;
}

export function parseBirth(text: string): ParsedBirth | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, '');
  const out: ParsedBirth = {};

  // 性别
  if (t.includes('男')) out.gender = 'male';
  else if (t.includes('女')) out.gender = 'female';

  // 年（“xx年”）
  const yearM = t.match(/([0-9零〇一二两三四五六七八九十廿卅]{2,4})年/);
  if (yearM) {
    const y = cnNumToInt(yearM[1]);
    if (y && y >= 1900 && y <= 2100) out.year = y;
    else if (yearM[1].length >= 3) {
      // 如“九零年” → 1990
      const y2 = cnNumToInt(yearM[1]);
      if (y2 !== null && y2 < 100) out.year = 1900 + y2;
    }
  }

  // 月（支持中文/阿拉伯；“腊月”“冬月”等口语）
  const monthM = t.match(/([0-9零〇一二两三四五六七八九十廿卅]{1,2})月/);
  if (monthM) {
    const m = cnNumToInt(monthM[1]);
    if (m && m >= 1 && m <= 12) out.month = m;
  } else if (/腊月/.test(t)) out.month = 12;
  else if (/冬月/.test(t)) out.month = 11;

  // 日（带“日/号”的显式写法）
  const dayM = t.match(/([0-9零〇一二两三四五六七八九十廿卅]{1,2})(?:日|号)/);
  if (dayM) {
    const d = cnNumToInt(dayM[1]);
    if (d && d >= 1 && d <= 31) out.day = d;
  }

  // 日（口语省略“日”字：“五月十五”“5月15” → 月份后直接跟数字）
  if (!out.day) {
    const dayM3 = t.match(/月([0-9零〇一二两三四五六七八九十廿卅]{1,2})(?:日|号)?/);
    if (dayM3) {
      const d = cnNumToInt(dayM3[1]);
      if (d && d >= 1 && d <= 31) out.day = d;
    }
  }

  // 时辰
  const hourM = t.match(/[子丑寅卯辰巳午未申酉戌亥](?:时|刻)?/);
  if (hourM) {
    const h = HOURS[hourM[0][0]];
    if (h !== undefined) out.hour = h;
  } else {
    // 数字时辰：如"5点""15点""十五点" → 小时 → 时辰序号
    // 子时=23-1点, 丑=1-3点, 寅=3-5点 … 公式：hour2 = floor((h+1)/2) % 12
    const numH = t.match(/([0-9零〇一二两三四五六七八九十廿卅]{1,2})[点时]/);
    if (numH) {
      const hh = cnNumToInt(numH[1]);
      if (hh !== null && hh >= 0 && hh <= 23) out.hour = Math.floor((hh + 1) / 2) % 12;
    }
  }

  // 兜底：没匹配到“日”但匹配到“号”等
  if (!out.day) {
    const dayM2 = t.match(/([0-9零〇一二两三四五六七八九十廿卅]{1,2})号/);
    if (dayM2) {
      const d = cnNumToInt(dayM2[1]);
      if (d && d >= 1 && d <= 31) out.day = d;
    }
  }

  // 农历标记：本轮明确说“农历/阴历”即置位（即使本轮年月日不全，标记随合并保留）
  if (LUNAR_MARK.test(t)) out.lunar = true;

  // 不再强制要求年份：本轮解析到什么字段就返回什么，由上游多轮合并决定完整性
  return out;
}

// 多轮合并：本轮新解析的字段覆盖已收集字段（用户更正时以新为准）；农历标记任一轮声明即保留
export function mergeBirth(next: ParsedBirth, prev: ParsedBirth): ParsedBirth {
  return {
    year: next.year ?? prev.year,
    month: next.month ?? prev.month,
    day: next.day ?? prev.day,
    hour: next.hour ?? prev.hour,
    gender: next.gender ?? prev.gender,
    lunar: next.lunar ?? prev.lunar,
  };
}

// 农历 → 公历：仅当标记农历且年月日齐全时换算；失败（如非法闰月）保持原样
export function applyLunar(birth: ParsedBirth): ParsedBirth {
  if (birth.lunar && birth.year && birth.month && birth.day) {
    try {
      const solar = Lunar.fromYmd(birth.year, birth.month, birth.day).getSolar();
      return { ...birth, year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(), lunar: true };
    } catch {
      return birth;
    }
  }
  return birth;
}
