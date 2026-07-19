const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5PublicSystemRouter(service) {
  const router = express.Router();
  router.get('/system/notice', wrapV5(async () => unwrap(await service.getSystemNotice())));
  router.get('/system/staff-contacts', wrapV5(async () => unwrap(await service.getStaffContacts())));
  return router;
}

module.exports = { createV5PublicSystemRouter };
