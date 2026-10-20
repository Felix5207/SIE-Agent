import {coordinateAxis} from './estimates.mjs';
// UI instructions are optional. Stored answer-format boilerplate is not user intent.
export function columnInstructions(field) {
  return String(field.instructions ?? field.description?.split('\n答案格式：')[0] ?? '').trim();
}
export function answerFormat(type, options=[]) {
  return {
    text:'用简短答案直接回答列名；默认保留核心总体统计和主要比较分组，保留单位与随数值报告的误差。去重，不附加无关统计或解释。用户明确指定详细范围时按其要求提取。',
    number:'value 必须是 JSON 数值或 null；单位写入 note。',
    boolean:'value 只能为 Yes、No、Maybe 或 null。',
    select:`value 必须为下列一个选项或 null：${options.join('；')}。`,
    multi:`value 必须为下列一个或多个选项，以英文分号分隔，或 null：${options.join('；')}。`,
  }[type || 'text'];
}
export function runtimeColumn(field) {
  const {description: _storedFormat, ...definition}=field;
  const coordinate=coordinateAxis(field.name,[field]);
  return {...definition,...(coordinate?{type:'text'}:{}),instructions:columnInstructions(field),answer_format:coordinate?'保留原文坐标写法、方向、度分秒、范围及分组，value 可为原文文本；不换算、不取中点。旧数值列也允许有原文证据的坐标文本。仅图片估读使用估算工具并标注误差。':answerFormat(field.type,field.options)};
}
