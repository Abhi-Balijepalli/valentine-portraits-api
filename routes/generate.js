import express from 'express'
import multer from 'multer'
import { generatePortrait, storeImageMetadata } from '../services/imageGenerator.js'

const router = express.Router()

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'), false)
    }
  }
})

/**
 * POST /api/generate
 * Upload an image and generate a styled portrait
 */
router.post('/generate', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' })
    }

    const theme = req.body.theme
    if (!theme) {
      return res.status(400).json({ error: 'No theme selected' })
    }

    const validThemes = ['renaissance', 'vangogh', 'ghibli', 'disney', 'anime', 'watercolor']
    if (!validThemes.includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme' })
    }

    console.log(`Generating ${theme} portrait...`)

    // Generate the portrait
    const result = await generatePortrait(req.file.buffer, theme)

    // Store metadata for later retrieval
    storeImageMetadata(result.imageId, {
      theme,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      imageUrl: result.imageUrl
    })

    res.json({
      success: true,
      imageId: result.imageId,
      imageUrl: result.imageUrl,
      theme
    })
  } catch (error) {
    console.error('Generation error:', error)
    res.status(500).json({ error: 'Failed to generate portrait' })
  }
})

export default router
