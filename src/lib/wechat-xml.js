function parseWechatXml(xmlText) {
  const text = String(xmlText || '');
  const pick = (tag) => {
    const match = text.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>|<${tag}>(.*?)<\\/${tag}>`, 's'));
    return (match && (match[1] || match[2] || '')).trim();
  };

  return {
    toUserName: pick('ToUserName'),
    fromUserName: pick('FromUserName'),
    msgType: pick('MsgType'),
    content: pick('Content'),
    event: pick('Event')
  };
}

module.exports = { parseWechatXml };
