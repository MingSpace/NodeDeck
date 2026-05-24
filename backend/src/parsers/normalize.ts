import type { Node } from "../schemas/node.js";

/**
 * 节点名 → ISO 3166-1 alpha-2 地区码识别表。
 *
 * 设计参考 subconverter (16k stars) 的 base/snippets/emoji.txt,核心要点:
 * 1. **词边界**:双字母国家码用 `\bXX\d*\b` 严格匹配,避免 "smart" → AR、"beijing" → IN、
 *    "limit-traffic" → IT、"trust" → TR 这类子串误判。早期实现用 `name.includes("ar")` 等
 *    裸子串匹配,会把任何含 "ar"/"in"/"it"/"tr" 等 2 字母片段的英文单词全部识别为对应国家。
 * 2. **alpha-3 严格化**:对 BE/AT/NO/IS/IT 这种"双字母 ISO 码等于高频英文单词"的地区,
 *    放弃 alpha-2 形式,只用 alpha-3 (BEL/AUT/NOR/ISL/ITA),避免 "be sure"/"at home"/
 *    "no proxy"/"is the best"/"it is" 这类副作用。GB 同理放弃(`100 GB` 单位干扰),只用 GBR。
 * 3. **三字母后缀 + 数字后缀**:`\bJP[N]?\d*\b` 同时覆盖 JP / JPN / JP01 / JPN02 / HKG-01 等。
 * 4. **顺序敏感**:扫描按下面表的顺序找第一个命中,所以
 *    - KP (朝鲜) 必须在 KR 前,否则 "North Korea" 被 KR 抢走(subconverter 用 `(?<!North\s)`
 *      负向后视,我们用排序解决,等效且避免后视兼容性顾虑)
 *    - CN 放最后,避免"中国"/"上海"等关键词被前面其他规则的歧义片段误抢
 *    - 高频地区(HK/TW/SG/JP/MO/KR/US)放最前,提高命中速度
 * 5. **城市/省份/ISP**:每个地区都附常见城市名(中英双语),提升机场命名的覆盖度。
 *    HK 含 HKT/HKBN/HGC/WTT/CMI、TW 含 CHT/HINET、MO 含 CTM 这些 ISP/接入点缩写也是
 *    机场命名常见的隐式地区标识。
 *
 * 已知 trade-off:
 * - 严格 alpha-3 之后,"BE-01"/"AT-01"/"IT-Milan" 这种纯 alpha-2 机场命名不会被识别,
 *   但这类命名罕见;真有需要,用户可以在节点 yaml 里手动指定 region。
 * - "100 GB 流量提醒"这种"广告位"节点不再误判为英国(原来 GB 关键词导致),改为 region=undefined,
 *   策略组 include_region 筛选时被排除,符合预期(广告位不是真节点)。
 */
const REGION_FLAGS: Array<{ code: string; pattern: RegExp }> = [
  // 亚洲高频区
  {
    code: "HK",
    pattern:
      /🇭🇰|\bHK[G]?\d*\b|\b(?:HKT|HKBN|HGC|WTT|CMI)\b|Hong\s*Kong|HongKong|香港|九龙|九龍|kowloon/i,
  },
  {
    code: "TW",
    pattern:
      /🇹🇼|\bTW[N]?\d*\b|\b(?:CHT|HINET)\b|Taiwan|Taipei|Kaohsiung|台湾|台灣|台北|高雄|新北|彰化/i,
  },
  {
    code: "SG",
    pattern: /🇸🇬|\bSG[P]?\d*\b|Singapore|新加坡|狮城|獅城/i,
  },
  {
    code: "JP",
    pattern:
      /🇯🇵|\bJP[N]?\d*\b|Japan|Tokyo|Osaka|Saitama|Yokohama|Nagoya|Kyoto|Sapporo|日本|东京|大阪|京都|横滨|名古屋|札幌|埼玉|川日|泉日/i,
  },
  // KP 必须在 KR 之前,防止 "North Korea" 被 KR 误抢
  {
    code: "KP",
    pattern: /🇰🇵|\bPRK?\d*\b|North\s*Korea|朝鲜|平壤|Pyongyang/i,
  },
  {
    code: "KR",
    pattern: /🇰🇷|\bKR\d*\b|\bKOR\d*\b|Korea|Seoul|Busan|韩国|韓國|首尔|釜山/i,
  },
  {
    code: "MO",
    pattern: /🇲🇴|\bMO\d*\b|\bMAC\d*\b|\bCTM\b|Macao|Macau|澳门|澳門/i,
  },
  // 北美/欧洲/大洋洲
  {
    code: "US",
    pattern:
      /🇺🇸|\bUS[A]?\d*\b|America|United\s*States|美国|美國|纽约|紐約|洛杉矶|洛杉磯|硅谷|圣何塞|聖荷西|圣克拉拉|西雅图|西雅圖|芝加哥|波特兰|波特蘭|达拉斯|達拉斯|凤凰城|鳳凰城|费利蒙|拉斯维加斯|拉斯維加斯|迈阿密|邁阿密|休斯顿|休斯頓|New\s*York|Los\s*Angeles|San\s*Jose|Santa\s*Clara|Seattle|Chicago|Miami|Dallas|Portland|Phoenix|Fremont|Las\s*Vegas|Houston/i,
  },
  {
    code: "CA",
    pattern:
      /🇨🇦|\bCAN?\d*\b|Canada|Toronto|Montreal|Vancouver|加拿大|多伦多|多倫多|蒙特利尔|蒙特利爾|温哥华|溫哥華|枫叶|楓葉/i,
  },
  // GB 不用 \bGB\d*\b,避免 "100 GB" GigaByte 单位误判;只用 GBR / UK / 完整名
  {
    code: "GB",
    pattern: /🇬🇧|\bUK\d*\b|\bGBR\d*\b|England|Britain|United\s*Kingdom|London|英国|英國|伦敦|倫敦/i,
  },
  {
    code: "DE",
    pattern: /🇩🇪|\bDE[U]?\d*\b|Germany|Deutschland|Frankfurt|Berlin|Munich|德国|德國|德意志|法兰克福|法蘭克福|柏林|慕尼黑/i,
  },
  {
    code: "FR",
    pattern: /🇫🇷|\bFRA?\d*\b|France|Paris|法国|法國|巴黎/i,
  },
  {
    code: "AU",
    pattern: /🇦🇺|\bAUS?\d*\b|Australia|Sydney|Melbourne|澳大利亚|澳大利亞|澳洲|悉尼|墨尔本|墨爾本/i,
  },
  {
    code: "NZ",
    pattern: /🇳🇿|\bNZL?\d*\b|New\s*Zealand|Auckland|新西兰|新西蘭|纽西兰|紐西蘭|奥克兰|奧克蘭/i,
  },
  {
    code: "NL",
    pattern: /🇳🇱|\bNLD?\d*\b|Netherlands|Holland|Amsterdam|荷兰|荷蘭|阿姆斯特丹/i,
  },
  {
    code: "CH",
    pattern: /🇨🇭|\bCHE\d*\b|Switzerland|Zurich|Geneva|瑞士|苏黎世|蘇黎世|日内瓦|日內瓦/i,
  },
  {
    code: "ES",
    pattern: /🇪🇸|\bES[P]?\d*\b|Spain|Espa[ñn]a|Madrid|Barcelona|西班牙|马德里|馬德里|巴塞罗那|巴塞羅那/i,
  },
  // PT 葡萄牙 / IT 意大利 / BE 比利时 / AT 奥地利 / NO 挪威 / IS 冰岛 / IE 爱尔兰
  // 这几个的 alpha-2 与高频英文词冲突(pt point / it / be / at / no / is / ie),
  // 一律只用 alpha-3 + 全名 + 城市,避免误判。
  {
    code: "IT",
    pattern: /🇮🇹|\bITA\d*\b|Italy|Italia|Milan|Milano|Rome|意大利|米兰|米蘭|罗马|羅馬/i,
  },
  {
    code: "PT",
    pattern: /🇵🇹|\bPRT\d*\b|Portugal|Lisbon|Lisboa|葡萄牙|里斯本/i,
  },
  {
    code: "BE",
    pattern: /🇧🇪|\bBEL\d*\b|Belgium|Brussels|比利时|比利時|布鲁塞尔|布魯塞爾/i,
  },
  {
    code: "AT",
    pattern: /🇦🇹|\bAUT\d*\b|Austria|Vienna|奥地利|奧地利|维也纳|維也納/i,
  },
  {
    code: "IE",
    pattern: /🇮🇪|\bIRL\d*\b|Ireland|Dublin|爱尔兰|愛爾蘭|都柏林/i,
  },
  // 北欧
  {
    code: "SE",
    pattern: /🇸🇪|\bSWE\d*\b|Sweden|Stockholm|瑞典|斯德哥尔摩|斯德哥爾摩/i,
  },
  {
    code: "NO",
    pattern: /🇳🇴|\bNOR\d*\b|Norway|Oslo|挪威|奥斯陆|奧斯陸/i,
  },
  {
    code: "DK",
    pattern: /🇩🇰|\bDNK\d*\b|\bDK\d*\b|Denmark|Copenhagen|丹麦|丹麥|哥本哈根/i,
  },
  {
    code: "FI",
    pattern: /🇫🇮|\bFIN\d*\b|Finland|Helsinki|芬兰|芬蘭|赫尔辛基|赫爾辛基/i,
  },
  {
    code: "IS",
    pattern: /🇮🇸|\bISL\d*\b|Iceland|Reykjavik|冰岛|冰島/i,
  },
  {
    code: "LU",
    pattern: /🇱🇺|\bLUX\d*\b|Luxembourg|Luxemburg|卢森堡|盧森堡/i,
  },
  {
    code: "PL",
    pattern: /🇵🇱|\bPOL\d*\b|\bPL\d*\b|Poland|Warsaw|波兰|波蘭|华沙|華沙/i,
  },
  {
    code: "UA",
    pattern: /🇺🇦|\bUKR\d*\b|Ukraine|Kyiv|Kiev|乌克兰|烏克蘭|基辅|基輔/i,
  },
  {
    code: "RU",
    pattern:
      /🇷🇺|\bRUS?\d*\b|Russia|Moscow|St\.?\s*Petersburg|Siberia|俄罗斯|俄羅斯|莫斯科|圣彼得堡|聖彼得堡|西伯利亚|西伯利亞|新西伯利亚|哈巴罗夫斯克|伯力/i,
  },
  {
    code: "TR",
    pattern: /🇹🇷|\bTUR?\d*\b|Turkey|T[uü]rkiye|Istanbul|土耳其|伊斯坦布尔|伊斯坦布爾/i,
  },
  // 东南亚 / 南亚
  {
    code: "TH",
    pattern: /🇹🇭|\bTHA?\d*\b|Thailand|Bangkok|泰国|泰國|曼谷/i,
  },
  {
    code: "VN",
    pattern: /🇻🇳|\bVNM?\d*\b|Vietnam|Hanoi|越南|河内|河內|胡志明/i,
  },
  {
    code: "MY",
    pattern: /🇲🇾|\bMYS\d*\b|Malaysia|Kuala\s*Lumpur|马来西亚|馬來西亞|吉隆坡/i,
  },
  {
    code: "PH",
    pattern: /🇵🇭|\bPHL\d*\b|\bPH\d*\b|Philippines|Manila|菲律宾|菲律賓|马尼拉|馬尼拉/i,
  },
  {
    code: "ID",
    pattern: /🇮🇩|\bIDN\d*\b|Indonesia|Jakarta|印尼|印度尼西亚|印度尼西亞|雅加达|雅加達/i,
  },
  {
    code: "IN",
    pattern: /🇮🇳|\bIND\d*\b|\bIN\d+\b|India|Mumbai|Bangalore|印度|孟买|孟買|班加罗尔|班加羅爾/i,
  },
  // 中东 / 非洲 / 拉美
  {
    code: "AE",
    pattern: /🇦🇪|\bUAE?\d*\b|Dubai|Emirates|阿联酋|阿聯酋|迪拜|杜拜/i,
  },
  {
    code: "IL",
    pattern: /🇮🇱|\bISR\d*\b|\bIL\d+\b|Israel|Tel\s*Aviv|Jerusalem|以色列|特拉维夫|特拉維夫|耶路撒冷/i,
  },
  {
    code: "EG",
    pattern: /🇪🇬|\bEGY?\d*\b|Egypt|Cairo|埃及|开罗|開羅/i,
  },
  {
    code: "ZA",
    pattern: /🇿🇦|\bZAF\d*\b|South\s*Africa|Johannesburg|南非|约翰内斯堡|約翰內斯堡/i,
  },
  {
    code: "BR",
    pattern: /🇧🇷|\bBRA\d*\b|Brazil|Brasil|S[ãa]o\s*Paulo|巴西|圣保罗|聖保羅|里约/i,
  },
  {
    code: "AR",
    pattern: /🇦🇷|\bARG\d*\b|Argentina|Buenos\s*Aires|阿根廷|布宜诺斯艾利斯|布宜諾斯艾利斯/i,
  },
  {
    code: "MX",
    pattern: /🇲🇽|\bMEX\d*\b|\bMX\d+\b|Mexico|墨西哥/i,
  },
  // CN 排最后:防"上海/北京/广州"等城市名被前面任何 alpha-2 误抢(虽然词边界后概率很低,
  // 仍保守地把 CN 后置)。同时也是 subconverter 的做法。
  // 不用 \bCN\b alpha-2:CNN 美国新闻台中 "CN" 不构成 \b 边界(CNN 整体是 \w),所以理论安全,
  // 但 \bCHN\d*\b 更稳;加上 \bCN\d+\b 强制带数字后缀,兼容 "CN01" "CN02" 这种命名。
  {
    code: "CN",
    pattern:
      /🇨🇳|\bCHN\d*\b|\bCN\d+\b|China|回国|back|中国|中國|上海|北京|广州|廣州|深圳|杭州|南京|成都|武汉|武漢|青岛|青島|天津|重庆|重慶|苏州|蘇州|郑州|鄭州|长沙|長沙|济南|濟南|宁波|寧波|厦门|廈門|Shanghai|Beijing|Guangzhou|Shenzhen|Hangzhou|Chengdu|Wuhan|Tianjin|Chongqing|Suzhou|Nanjing|Qingdao|Xiamen/i,
  },
];

const LEVEL_KEYWORDS: Array<{ regex: RegExp; level: string }> = [
  { regex: /(?:实验性|experiment(?:al)?)/i, level: "experimental" },
  { regex: /(?:premium|高级|尊享|精品)/i, level: "premium" },
  { regex: /(?:标准|standard)/i, level: "standard" },
];

const LINE_KEYWORDS: Array<{ regex: RegExp; line: string }> = [
  { regex: /\bIEPL\b/i, line: "IEPL" },
  { regex: /\bIPLC\b/i, line: "IPLC" },
  { regex: /\bBGP\b/i, line: "BGP" },
  { regex: /\bGIA\b/i, line: "GIA" },
  { regex: /\bCN2\b/i, line: "CN2" },
];

export function annotateNode(node: Node): Node {
  if (!node.region) {
    for (const r of REGION_FLAGS) {
      if (r.pattern.test(node.name)) {
        node.region = r.code;
        break;
      }
    }
  }
  if (!node.level) {
    for (const l of LEVEL_KEYWORDS) {
      if (l.regex.test(node.name)) {
        node.level = l.level;
        break;
      }
    }
  }
  if (!node.line) {
    for (const l of LINE_KEYWORDS) {
      if (l.regex.test(node.name)) {
        node.line = l.line;
        break;
      }
    }
  }
  return node;
}

export function annotateNodes(nodes: Node[]): Node[] {
  return nodes.map(annotateNode);
}
