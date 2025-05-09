const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const router = express.Router();

// Folder upload
const uploadPath = path.join(__dirname, './uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Gunakan multer untuk simpan file sementara
const storage = multer.memoryStorage(); // simpan di memori sementara
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // max 2MB
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/');
    cb(null, isImage);
  },
});

// POST /api/upload
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const newFileName = `${userId}.webp`;
    const outputPath = path.join(uploadPath, newFileName);

    // Hapus file lama jika ada
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    // Konversi ke WebP dan simpan
    await sharp(req.file.buffer)
      .webp({ quality: 80 })
      .toFile(outputPath);

    const fileUrl = `/uploads/${newFileName}`;
    res.json({ url: fileUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'File processing failed' });
  }
});

module.exports = router;
