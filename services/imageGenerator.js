import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'
import { GoogleGenerativeAI } from '@google/generative-ai'
import convert from 'heic-convert'
import { createClient } from '@supabase/supabase-js'

// Lazy initialize Supabase
let supabase = null
function getSupabase() {
  if (supabase === null && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  }
  return supabase
}

const BUCKET_NAME = 'images'

// Lazy initialize Gemini
let genAI = null
function getGenAI() {
  if (genAI === null && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return genAI
}

// Style prompts for the 3-pack
const STYLE_PROMPTS = {
  'oil-painting': `Transform this photo into a beautiful traditional oil painting on canvas.

KEEP EXACTLY:
- Same faces, expressions, poses
- Same composition and framing

MAKE IT LOOK LIKE A REAL OIL PAINTING:
- Heavy, visible oil paint brushstrokes throughout
- Thick impasto texture like Van Gogh or Renoir
- Rich, creamy paint texture on canvas
- Soft blended edges between colors
- Classic portrait painting style from the 1800s

COLOR PALETTE:
- Warm golden undertones
- Soft romantic pinks and peaches
- Rich saturated colors
- Glowing warm skin tones

Make it look like a museum-quality oil painting that was hand-painted on canvas with thick brushstrokes. NOT a photo filter - a real painted look.`,

  'studio-ghibli': `Transform this photo into a Studio Ghibli anime style illustration.

KEEP EXACTLY:
- Same faces, expressions, poses
- Same composition and framing

MAKE IT LOOK LIKE STUDIO GHIBLI:
- Soft watercolor backgrounds with dreamy atmosphere
- Clean anime-style character designs like Miyazaki films
- Gentle, warm lighting with soft shadows
- Whimsical, magical feeling
- Hand-painted watercolor texture

COLOR PALETTE:
- Soft pastels and warm earth tones
- Gentle sky blues and sunset oranges
- Lush greens and romantic pinks
- Dreamy, slightly desaturated colors

Make it look like a still frame from a Hayao Miyazaki film - magical, heartwarming, and beautifully hand-drawn.`,

  'mona-lisa': `Transform this photo into a Renaissance masterpiece portrait.

KEEP EXACTLY:
- Same faces, expressions, poses
- Same composition and framing

MAKE IT LOOK LIKE A RENAISSANCE PAINTING:
- Da Vinci sfumato technique with soft, hazy edges
- Rich oil paint texture on aged canvas
- Dramatic chiaroscuro lighting
- Classical Renaissance composition
- Subtle craquelure (aged painting cracks)

COLOR PALETTE:
- Rich warm browns and deep shadows
- Soft flesh tones with warm undertones
- Dark, moody backgrounds
- Golden highlights and amber tones

Make it look like a museum masterpiece from the Italian Renaissance, painted by Da Vinci or Raphael - timeless, elegant, and classical.`
}

function isHeic(buffer) {
  if (buffer.length < 12) return false
  const brand = buffer.slice(8, 12).toString('ascii')
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1'].includes(brand.toLowerCase())
}

async function convertHeicToJpeg(buffer) {
  const outputBuffer = await convert({
    buffer: buffer,
    format: 'JPEG',
    quality: 0.95
  })
  return Buffer.from(outputBuffer)
}

async function preprocessImage(imageBuffer) {
  let buffer = imageBuffer

  if (isHeic(buffer)) {
    buffer = await convertHeicToJpeg(buffer)
  }

  return sharp(buffer, { failOn: 'none', limitInputPixels: false })
    .rotate()
    .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer()
}

async function uploadToSupabase(imageBuffer, imageId, subfolder = null) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase not configured')

  const filename = subfolder
    ? `valentines/${subfolder}/${imageId}.jpg`
    : `valentines/${imageId}.jpg`

  const { error } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filename, imageBuffer, { contentType: 'image/jpeg', upsert: true })

  if (error) throw error

  const { data: urlData } = sb.storage.from(BUCKET_NAME).getPublicUrl(filename)
  return urlData.publicUrl
}

async function generateWithGemini(imageBuffer, style = 'oil-painting') {
  const ai = getGenAI()
  if (!ai) throw new Error('Gemini API not configured')

  const model = ai.getGenerativeModel({
    model: 'gemini-3-pro-image-preview',
    generationConfig: { responseModalities: ['Text', 'Image'] }
  })

  const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS['oil-painting']

  console.log(`Sending ${style} prompt to Gemini...`)
  const result = await model.generateContent([
    { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
    prompt
  ])

  const response = await result.response
  console.log(`Gemini response received for ${style}`)

  // Log any text response from Gemini
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.text) {
      console.log('Gemini text response:', part.text)
    }
    if (part.inlineData) {
      console.log('Gemini returned image, mimeType:', part.inlineData.mimeType)
      return Buffer.from(part.inlineData.data, 'base64')
    }
  }

  throw new Error('No image generated')
}

export async function generatePortrait(imageBuffer) {
  const imageId = uuidv4()

  // Preprocess
  const processedBuffer = await preprocessImage(imageBuffer)

  // Generate with Gemini
  let outputBuffer
  try {
    outputBuffer = await generateWithGemini(processedBuffer)
    outputBuffer = await sharp(outputBuffer)
      .resize(2160, 3840, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 95 })
      .toBuffer()
  } catch (error) {
    console.error('Gemini generation failed:', error.message)
    console.log('Using fallback filter...')
    // Fallback to simple filter
    outputBuffer = await sharp(processedBuffer)
      .resize(2160, 3840, { fit: 'cover', position: 'center' })
      .modulate({ brightness: 1.1, saturation: 1.2 })
      .tint({ r: 255, g: 230, b: 240 })
      .jpeg({ quality: 95 })
      .toBuffer()
  }

  // Upload
  const imageUrl = await uploadToSupabase(outputBuffer, imageId)

  return { imageId, imageUrl }
}

// Helper to delay between API calls
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Generate 3-pack of portraits with different styles
export async function generatePortraitPack(imageBuffer, onProgress = null) {
  const sessionId = uuidv4()
  const styles = ['oil-painting', 'studio-ghibli', 'mona-lisa']
  const images = []

  // Preprocess once
  const processedBuffer = await preprocessImage(imageBuffer)

  for (let i = 0; i < styles.length; i++) {
    const style = styles[i]

    if (onProgress) {
      onProgress({ current: i + 1, total: styles.length, style })
    }

    console.log(`Generating ${style} (${i + 1}/${styles.length})...`)

    let outputBuffer
    try {
      outputBuffer = await generateWithGemini(processedBuffer, style)
      outputBuffer = await sharp(outputBuffer)
        .resize(2160, 3840, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 95 })
        .toBuffer()
    } catch (error) {
      console.error(`Gemini generation failed for ${style}:`, error.message)
      console.log('Using fallback filter...')
      // Fallback to simple filter with style-specific tints
      const tints = {
        'oil-painting': { r: 255, g: 230, b: 240 },
        'studio-ghibli': { r: 240, g: 255, b: 250 },
        'mona-lisa': { r: 255, g: 240, b: 220 }
      }
      outputBuffer = await sharp(processedBuffer)
        .resize(2160, 3840, { fit: 'cover', position: 'center' })
        .modulate({ brightness: 1.1, saturation: 1.2 })
        .tint(tints[style] || tints['oil-painting'])
        .jpeg({ quality: 95 })
        .toBuffer()
    }

    // Upload to Supabase folder: valentines/{sessionId}/{style}.jpg
    const imageUrl = await uploadToSupabase(outputBuffer, style, sessionId)
    const imageId = `${sessionId}_${style}`

    images.push({ imageId, imageUrl, style })

    // Add delay between API calls (except after the last one)
    if (i < styles.length - 1) {
      console.log('Waiting 1 second before next generation...')
      await delay(1000)
    }
  }

  return { sessionId, images }
}

const imageStore = new Map()

export function storeImageMetadata(imageId, metadata) {
  imageStore.set(imageId, { ...metadata, createdAt: new Date().toISOString() })
}

export function getImageMetadata(imageId) {
  return imageStore.get(imageId)
}

export function getImagePath(imageId) {
  return imageStore.get(imageId)?.imageUrl || null
}
