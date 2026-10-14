/** Chinese display labels only. Native message operands and Japanese labels
 * remain in source.originalDisplayText. Proper-name spellings are attested in
 * the same Chinese patch: EV23/76 智树, ED3/975 美树, EV01/74 须摩子.
 * Occupation/collective labels translate the written role without assigning a
 * previously unknown speaker to a named character.
 */
export const KANA_CHINESE_SPEAKER_LABELS = Object.freeze({
  '智樹': '智树',
  '美樹': '美树',
  '須摩子': '须摩子',
  '医師': '医生',
  '店員': '店员',
  '教師': '教师',
  '担任': '班主任',
  '母親': '母亲',
  '友達': '朋友',
  '生徒': '学生',
  '子供': '小孩子',
  '子供Ａ': '小孩子Ａ',
  '子供Ｂ': '小孩子Ｂ',
  '子供Ｃ': '小孩子Ｃ',
  '子供達': '孩子们',
  '司会': '主持人',
  '司書': '图书管理员',
  '全員': '全员',
  '音声': '声音',
  '声': '声音',
  '放送': '广播',
  '家族': '家人',
});
export const localizeKanaChineseSpeaker = value => KANA_CHINESE_SPEAKER_LABELS[value] ?? value;
