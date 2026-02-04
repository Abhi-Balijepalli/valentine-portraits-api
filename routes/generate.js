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
  console.log('=== /api/generate called ===')
  console.log('Request body:', req.body)
  console.log('File received:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE')

  try {
    if (!req.file) {
      console.log('ERROR: No image file provided')
      return res.status(400).json({ error: 'No image file provided' })
    }

    const theme = req.body.theme
    console.log('Theme requested:', theme)

    if (!theme) {
      console.log('ERROR: No theme selected')
      return res.status(400).json({ error: 'No theme selected' })
    }

    const validThemes = ['renaissance', 'vangogh', 'ghibli', 'disney', 'watercolor']
    if (!validThemes.includes(theme)) {
      console.log('ERROR: Invalid theme:', theme)
      return res.status(400).json({ error: 'Invalid theme' })
    }

    console.log(`Starting generation for ${theme}...`)

    // Generate the portrait
    const result = await generatePortrait(req.file.buffer, theme)

    console.log('Generation result:', result)

    // Store metadata for later retrieval
    storeImageMetadata(result.imageId, {
      theme,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      imageUrl: result.imageUrl
    })

    console.log('Sending response with imageUrl:', result.imageUrl)

    res.json({
      success: true,
      imageId: result.imageId,
      imageUrl: result.imageUrl,
      theme
    })
  } catch (error) {
    console.error('=== GENERATION ERROR ===')
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    res.status(500).json({ error: 'Failed to generate portrait', details: error.message })
  }
})

export default router
