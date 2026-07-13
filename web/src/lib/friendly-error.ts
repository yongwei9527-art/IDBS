export function toFriendlyError(error: unknown, fallback = '操作失败，请稍后重试') {
  const raw = error instanceof Error ? error.message : String(error || '');
  const text = raw.replace(/Error:/gi, '').trim();
  const lower = text.toLowerCase();
  if (/failed to fetch|networkerror|network request failed|load failed|econnrefused|econnreset|etimedout/.test(lower)) return '网络连接异常，请确认服务已启动后重试。';
  if (/unauthorized|jwt|token|401/.test(lower)) return '登录状态已失效，请重新登录。';
  if (/forbidden|not allowed|permission|denied|403/.test(lower)) return '当前账号没有权限执行该操作。';
  if (/timeout/.test(lower)) return '请求超时，请稍后重试。';
  if (/required|missing|must be|invalid|not valid|validation/.test(lower)) return '提交内容不完整或格式不正确，请补全后重试。';
  if (/duplicate|conflict|already exists|409/.test(lower)) return '当前数据已存在或状态冲突，请刷新后重试。';
  if (/file is required|missing file/.test(lower)) return '请选择需要上传的文件。';
  if (/only image|allowed image|unsupported file|content does not match/.test(lower)) return '仅支持上传真实图片文件（JPG、PNG、WebP、GIF）。';
  if (/internal server error|server error|database|sql|postgres|prisma|500/.test(lower)) return '服务器暂时无法处理请求，请稍后再试。';
  if (/typeerror|referenceerror|cannot read|undefined|null/.test(lower)) return '页面处理数据时遇到异常，请刷新后重试；如果仍失败请联系管理员。';
  return /[一-龥]/.test(text) ? text : fallback;
}
