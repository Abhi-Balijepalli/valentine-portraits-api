import express from 'express'
import Stripe from 'stripe'
import { getImagePath, getImageMetadata } from '../services/imageGenerator.js'
import archiver from 'archiver'

const router = express.Router()

// Lazy initialize Stripe
let stripe = null
function getStripe() {
  if (stripe === null && process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  }
  return stripe
}

const checkoutSessions = new Map()

/**
 * POST /api/create-checkout
 * Create a Stripe Checkout session for purchasing images (single or bundle)
 */
router.post('/create-checkout', async (req, res) => {
  try {
    const { imageId, imageIds, bundle } = req.body

    // Handle both single image and bundle
    const ids = imageIds?.length ? imageIds : (imageId ? [imageId] : [])

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Image ID(s) required' })
    }

    // Verify all images exist
    for (const id of ids) {
      const metadata = getImageMetadata(id)
      if (!metadata) {
        return res.status(404).json({ error: `Image ${id} not found` })
      }
    }

    // Mock checkout for testing without Stripe
    if (!getStripe()) {
      console.log('Stripe not configured - returning mock checkout URL')
      const mockSessionId = `mock_${Date.now()}_bundle`
      checkoutSessions.set(mockSessionId, { imageIds: ids, paid: true })

      return res.json({
        url: `${req.headers.origin || 'http://localhost:5173'}?session_id=${mockSessionId}`,
        sessionId: mockSessionId,
        mock: true
      })
    }

    const productName = "imagegen.studio Valentine's Day 3-Pack Portraits"

    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: productName,
              description: '3 Unique 4K AI Art Portraits (2160x3840) - Oil Painting, Studio Ghibli, Renaissance',
              images: []
            },
            unit_amount: 899 // $8.99
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${req.headers.origin || 'http://localhost:5173'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:5173'}`,
      metadata: {
        imageIds: JSON.stringify(ids)
      },
      payment_intent_data: {
        description: productName
      },
      custom_text: {
        submit: {
          message: 'Your 3 unique 4K portraits will be available for instant download after payment. Contact: imagegen.studio.help@gmail.com'
        }
      },
      allow_promotion_codes: true
    })

    checkoutSessions.set(session.id, { imageIds: ids, paid: false })

    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    console.error('Checkout error:', error)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
})

/**
 * GET /api/download/:sessionId
 * Download images after successful payment (single or bundle as ZIP)
 */
router.get('/download/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params
    let imageIds = []

    // Handle mock sessions
    if (sessionId.startsWith('mock_')) {
      const sessionData = checkoutSessions.get(sessionId)
      if (!sessionData) {
        return res.status(404).json({ error: 'Session not found' })
      }
      imageIds = sessionData.imageIds
    } else {
      // Verify Stripe session
      if (!getStripe()) {
        return res.status(500).json({ error: 'Payment system not configured' })
      }

      const session = await getStripe().checkout.sessions.retrieve(sessionId)

      if (session.payment_status !== 'paid') {
        return res.status(402).json({ error: 'Payment not completed' })
      }

      imageIds = JSON.parse(session.metadata.imageIds || '[]')
    }

    if (imageIds.length === 0) {
      return res.status(404).json({ error: 'No images found' })
    }

    const themeNames = {
      'oil-painting': 'OilPainting',
      'studio-ghibli': 'StudioGhibli',
      'mona-lisa': 'Renaissance',
      // Legacy theme names for backwards compatibility
      renaissance: 'Renaissance',
      vangogh: 'VanGogh',
      ghibli: 'StudioGhibli',
      disney: 'DisneyPixar',
      watercolor: 'Watercolor'
    }

    // Fetch images from Supabase URLs
    const fetchImage = async (id) => {
      const metadata = getImageMetadata(id)
      if (!metadata?.imageUrl) {
        throw new Error(`No URL for image ${id}`)
      }
      const response = await fetch(metadata.imageUrl)
      if (!response.ok) throw new Error(`Failed to fetch image ${id}`)
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        theme: metadata.theme
      }
    }

    // Single image - return directly
    if (imageIds.length === 1) {
      const { buffer } = await fetchImage(imageIds[0])
      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Disposition': 'attachment; filename="valentine-portrait.jpg"'
      })
      return res.send(buffer)
    }

    // Multiple images - create ZIP
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="Valentines imagegen.studio.zip"'
    })

    const archive = archiver('zip', { zlib: { level: 5 } })
    archive.pipe(res)

    const folderName = 'Valentines imagegen.studio'
    for (const id of imageIds) {
      try {
        const { buffer, theme } = await fetchImage(id)
        const themeName = themeNames[theme] || 'Portrait'
        const filename = `${folderName}/Valentine-Portrait-${themeName}.jpg`
        archive.append(buffer, { name: filename })
      } catch (err) {
        console.error(`Failed to fetch image ${id}:`, err)
      }
    }

    await archive.finalize()
  } catch (error) {
    console.error('Download error:', error)
    res.status(500).json({ error: 'Failed to download images' })
  }
})

const SUPABASE_PUBLIC_URL = 'https://vvftrcuiettbrcvivulv.supabase.co/storage/v1/object/public/images'

/**
 * GET /api/images/:sessionId
 * Get image URLs for a paid session
 */
router.get('/images/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params

    // Helper to construct image URL from imageId
    const constructImageUrl = (imageId) => {
      // imageId format: {uuid}_{style} e.g. "abc123_oil-painting"
      const parts = imageId.split('_')
      if (parts.length >= 2) {
        const uuid = parts.slice(0, -1).join('_') // Handle UUIDs with underscores
        const style = parts[parts.length - 1]
        return `${SUPABASE_PUBLIC_URL}/valentines/${uuid}/${style}.jpg`
      }
      return null
    }

    // Helper to extract style from imageId
    const extractStyle = (imageId) => {
      const parts = imageId.split('_')
      return parts[parts.length - 1]
    }

    // Handle mock sessions
    if (sessionId.startsWith('mock_')) {
      const sessionData = checkoutSessions.get(sessionId)
      if (!sessionData) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const images = sessionData.imageIds.map(id => {
        const metadata = getImageMetadata(id)
        const style = metadata?.theme || extractStyle(id)
        return {
          imageId: id,
          imageUrl: metadata?.imageUrl || constructImageUrl(id),
          style
        }
      }).filter(img => img.imageUrl)

      return res.json({ images })
    }

    // Verify Stripe session
    if (!getStripe()) {
      return res.status(500).json({ error: 'Payment system not configured' })
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId)

    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' })
    }

    const imageIds = JSON.parse(session.metadata.imageIds || '[]')

    const images = imageIds.map(id => {
      const metadata = getImageMetadata(id)
      const style = metadata?.theme || extractStyle(id)
      return {
        imageId: id,
        imageUrl: metadata?.imageUrl || constructImageUrl(id),
        style
      }
    }).filter(img => img.imageUrl)

    res.json({ images })
  } catch (error) {
    console.error('Get images error:', error)
    res.status(500).json({ error: 'Failed to get images' })
  }
})

/**
 * POST /api/webhook
 * Stripe webhook for payment events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!getStripe()) {
    return res.status(500).json({ error: 'Stripe not configured' })
  }

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    return res.status(400).json({ error: 'Webhook secret not configured' })
  }

  let event

  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object
      console.log('Payment successful for session:', session.id)
      if (checkoutSessions.has(session.id)) {
        checkoutSessions.get(session.id).paid = true
      }
      break

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  res.json({ received: true })
})

export default router
