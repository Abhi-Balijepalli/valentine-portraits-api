import express from 'express'
import multer from 'multer'
import { generatePortraitPack, storeImageMetadata } from '../services/imageGenerator.js'

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
 * Upload an image and generate a 3-pack of styled portraits
 */
router.post('/generate', upload.single('image'), async (req, res) => {
  console.log('=== /api/generate called ===')
  console.log('File received:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE')

  try {
    if (!req.file) {
      console.log('ERROR: No image file provided')
      return res.status(400).json({ error: 'No image file provided' })
    }

    console.log('Starting 3-pack portrait generation...')

    // Generate the portrait pack (3 styles)
    const result = await generatePortraitPack(req.file.buffer)

    console.log('Generation result:', result)

    // Store metadata for all 3 images
    for (const img of result.images) {
      storeImageMetadata(img.imageId, {
        theme: img.style,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        imageUrl: img.imageUrl,
        sessionId: result.sessionId
      })
    }

    console.log('Sending response with', result.images.length, 'images')

    res.json({
      success: true,
      sessionId: result.sessionId,
      images: result.images
    })
  } catch (error) {
    console.error('=== GENERATION ERROR ===')
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    res.status(500).json({ error: 'Failed to generate portraits', details: error.message })
  }
})

export default router
