const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { AppError } = require('../lib/app-error');
const { sendError, success } = require('../lib/http');
const { requireAuth } = require('../lib/auth');

function createUploadRouter({ service, uploadDir }) {
  const router = express.Router();
  const imageTypes = {
    'image/jpeg': { ext: '.jpg', signatures: [(buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff] },
    'image/png': { ext: '.png', signatures: [(buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))] },
    'image/webp': { ext: '.webp', signatures: [(buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'] },
    'image/gif': { ext: '.gif', signatures: [(buffer) => buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))] }
  };
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
      if (!imageTypes[file.mimetype]) {
        return cb(new AppError('仅支持上传图片文件', { status: 400, code: 2001 }));
      }
      cb(null, true);
    }
  });

  router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          code: 2001,
          message: '请选择需要上传的文件',
          data: null
        });
      }

      const buffer = await fs.promises.readFile(req.file.path);
      const detected = imageTypes[req.file.mimetype];
      if (!detected.signatures.some((matches) => matches(buffer))) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        throw new AppError('上传文件内容与图片类型不匹配', { status: 400, code: 2001 });
      }

      const filename = `${Date.now()}-${crypto.randomUUID()}${detected.ext}`;
      const target = path.join(uploadDir, filename);
      await fs.promises.rename(req.file.path, target);
      const url = `/uploads/${filename}`;
      return res.json({
        ...success({ url }, 'success', res.getHeader('X-Request-Id')),
        url
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { createUploadRouter };
