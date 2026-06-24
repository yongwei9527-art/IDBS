exports.main = async () => ({
  ok: false,
  status: 410,
  code: 3001,
  message: 'This CloudBase function entry is deprecated. Use the VPS HTTP API in server.js instead.'
});
