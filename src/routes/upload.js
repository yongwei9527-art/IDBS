const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { AppError } = require('../lib/app-error');
const { sendError, success } = require('../lib/http');

function createUploadRouter({ service, uploadDir }) {
  const router = express.Router();
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new AppError('Only image uploads are allowed', { status: 400, code: 2001 }));
      }
      cb(null, true);
    }
  });

  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          code: 2001,
          message: 'file is required',
          data: null
        });
      }

      const filename = `${Date.now()}-${service.safeFilename(req.file.originalname)}`;
      const target = path.join(uploadDir, filename);
      fs.renameSync(req.file.path, target);
      const url = `/uploads/${filename}`;
      return res.json({
        ...success({ url }),
        url
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { createUploadRouter };
