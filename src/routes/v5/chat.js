const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function requireChatEventAuth() {
  return function (req, _res, next) {
    const token = String(req.query?.token || '').trim();
    const payload = verifyJwt(token, { type: 'access' });
    if (!payload) return next(new AppError('Unauthorized.', { status: 401, code: 1001 }));
    req.auth = payload;
    req.authToken = token;
    return next();
  };
}

function createV5ChatRouter(service) {
  const router = express.Router();
  router.get('/chat/events', requireChatEventAuth(), async (req, res, next) => {
    try {
      await service.streamChatEvents(req, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      return next(error);
    }
  });
  router.use(requireAuth);
  router.get('/chat/users', wrapV5(async (req) => unwrap(await service.listChatUsers(req.query || {}, serviceAuth(req)))));
  router.get('/chat/conversations', wrapV5(async (req) => unwrap(await service.listChatConversations(req.query || {}, serviceAuth(req)))));
  router.post('/chat/conversations', wrapV5(async (req) => unwrap(await service.createChatConversation(req.body || {}, serviceAuth(req)))));
  router.post('/chat/conversations/:id/participants', wrapV5(async (req) => unwrap(await service.addChatParticipants({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.delete('/chat/conversations/:id/participants/:userId', wrapV5(async (req) => unwrap(await service.removeChatParticipant({ ...req.body, conversation_id: req.params.id, user_id: req.params.userId }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/participants/:userId/remove', wrapV5(async (req) => unwrap(await service.removeChatParticipant({ ...req.body, conversation_id: req.params.id, user_id: req.params.userId }, serviceAuth(req)))));
  router.get('/chat/conversations/:id/messages', wrapV5(async (req) => unwrap(await service.listChatMessages({ ...req.query, conversation_id: req.params.id }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/messages', wrapV5(async (req) => unwrap(await service.sendChatMessage({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.patch('/chat/conversations/:id/read', wrapV5(async (req) => unwrap(await service.markChatConversationRead({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/leave', wrapV5(async (req) => unwrap(await service.leaveChatConversation({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.delete('/chat/conversations/:id', wrapV5(async (req) => unwrap(await service.dissolveChatConversation({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5ChatRouter };
