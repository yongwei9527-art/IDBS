const express = require('express');
const { createV5AuthRouter } = require('./auth');
const { createV5DevicesRouter } = require('./devices');
const { createV5PublicSystemRouter } = require('./public-system');
const { createV5ReservationsRouter } = require('./reservations');
const { createV5BorrowRouter } = require('./borrow');
const { createV5ChatRouter } = require('./chat');
const { createV5NotificationRouter } = require('./notifications');
const { createV5AdminRouter } = require('./admin');
const { unwrap, serviceAuth } = require('./helpers');

function createV5Router(service, { refreshSessions, runtimeDiagnostics } = {}) {
  const router = express.Router();
  router.use(createV5AuthRouter(service, { refreshSessions }));
  router.use(createV5PublicSystemRouter(service));
  router.use(createV5DevicesRouter(service));
  router.use(createV5ReservationsRouter(service));
  router.use(createV5BorrowRouter(service));
  router.use(createV5ChatRouter(service));
  router.use(createV5NotificationRouter(service));
  router.use(createV5AdminRouter(service, { runtimeDiagnostics }));
  router.use((err, req, res, _next) => {
    const { sendFail } = require('../../lib/v5-http');
    sendFail(res, err, req);
  });
  return router;
}

module.exports = { createV5Router, createV5AuthRouter, unwrap, serviceAuth };
