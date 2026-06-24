const express = require('express');
const { sendError } = require('../lib/http');
const { parseWechatXml } = require('../lib/wechat-xml');

function createWechatRouter(service) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const echostr = await service.verifyWechatHandshake(req.query || {});
      return res.type('text/plain').send(echostr);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/', async (req, res) => {
    let body = {};
    try {
      await service.verifyWechatHandshake(req.query || {});
      body = parseWechatXml(req.body || '');
      if (body.msgType !== 'text') {
        return res.type('application/xml').send(service.buildWechatReply(
          body.fromUserName,
          body.toUserName,
          '目前仅支持发送登录验证码。'
        ));
      }

      const reply = await service.handleWechatMessage({
        openid: body.fromUserName,
        content: body.content
      });

      return res.type('application/xml').send(service.buildWechatReply(
        body.fromUserName,
        body.toUserName,
        reply
      ));
    } catch (error) {
      console.error('WeChat callback failed:', error);
      return res.type('application/xml').send(service.buildWechatReply(
        body.fromUserName || '',
        body.toUserName || '',
        '系统繁忙，请稍后重试。'
      ));
    }
  });

  return router;
}

module.exports = { createWechatRouter };
