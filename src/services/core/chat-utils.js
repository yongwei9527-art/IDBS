const { isSafeUrl } = require('./service-utils');

function cleanChatJsonValue(value, depth = 0) {
  if (depth > 3 || value === undefined || typeof value === 'function') return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim().slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanChatJsonValue(item, depth + 1)).filter((item) => item !== null);
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 20)) {
      const safeKey = String(key || '').trim().slice(0, 60);
      if (!safeKey) continue;
      const safeValue = cleanChatJsonValue(item, depth + 1);
      if (safeValue !== null) output[safeKey] = safeValue;
    }
    return output;
  }
  return null;
}

function normalizeChatMetadata(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = raw.trim() ? { note: raw.trim().slice(0, 500) } : {};
    }
  }
  const cleaned = cleanChatJsonValue(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const text = JSON.stringify(cleaned || {});
  if (text.length > 4000) return {};
  return cleaned || {};
}

function normalizeChatAttachments(value) {
  const rawList = Array.isArray(value) ? value : (value ? [value] : []);
  return rawList.slice(0, 5).map((item) => {
    const raw = typeof item === 'string' ? { url: item } : (item && typeof item === 'object' ? item : {});
    const url = String(raw.url || raw.src || raw.href || '').trim();
    if (!url || !isSafeUrl(url)) return null;
    return {
      type: String(raw.type || '').trim().slice(0, 40) || (String(raw.mime || '').startsWith('image/') ? 'image' : 'file'),
      url,
      name: String(raw.name || raw.filename || '附件').trim().slice(0, 120),
      mime: String(raw.mime || raw.content_type || '').trim().slice(0, 120),
      size: Math.max(0, Math.min(Number(raw.size || 0) || 0, 25 * 1024 * 1024)),
      thumb_url: raw.thumb_url && isSafeUrl(raw.thumb_url) ? String(raw.thumb_url).trim() : ''
    };
  }).filter(Boolean);
}

function chatCardContent(messageType, metadata = {}, labels = {}) {
  const label = labels[messageType] || '业务卡片';
  const code = metadata.device_code || metadata.device_name || metadata.reservation_id || metadata.batch_id || metadata.fault_id || metadata.request_id || metadata.title || '';
  return code ? `${label}：${String(code).slice(0, 120)}` : label;
}

function relatedTypeForChatMessage(messageType, payload = {}, metadata = {}, relatedTypes = {}) {
  if (payload.related_type || payload.relatedType) return String(payload.related_type || payload.relatedType).trim().slice(0, 60);
  return relatedTypes[messageType] || metadata.related_type || null;
}

function relatedIdForChatMessage(messageType, payload = {}, metadata = {}) {
  if (payload.related_id || payload.relatedId) return String(payload.related_id || payload.relatedId).trim().slice(0, 120);
  if (messageType === 'device_card') return metadata.device_id || metadata.device_code || null;
  if (messageType === 'reservation_card') return metadata.reservation_id || metadata.batch_id || null;
  if (messageType === 'fault_card') return metadata.fault_id || metadata.report_id || null;
  if (messageType === 'user_request_card') return metadata.request_id || null;
  return metadata.related_id || metadata.relatedId
    || metadata.reservation_id || metadata.reservationId
    || metadata.batch_id || metadata.batchId
    || metadata.fault_id || metadata.faultId
    || metadata.request_id || metadata.requestId
    || metadata.device_id || metadata.deviceId
    || metadata.device_code || metadata.deviceCode
    || null;
}

module.exports = {
  chatCardContent,
  cleanChatJsonValue,
  normalizeChatAttachments,
  normalizeChatMetadata,
  relatedIdForChatMessage,
  relatedTypeForChatMessage
};
