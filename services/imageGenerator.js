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

async function uploadToSupabase(imageBuffer, imageId) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase not configured')

  const filename = `valentines/${imageId}.jpg`

  const { error } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filename, imageBuffer, { contentType: 'image/jpeg', upsert: true })

  if (error) throw error

  const { data: urlData } = sb.storage.from(BUCKET_NAME).getPublicUrl(filename)
  return urlData.publicUrl
}

async function generateWithGemini(imageBuffer) {
  const ai = getGenAI()
  if (!ai) throw new Error('Gemini API not configured')

  const model = ai.getGenerativeModel({
    model: 'gemini-3-pro-image-preview',
    generationConfig: { responseModalities: ['Text', 'Image'] }
  })

  const prompt = `Transform this photo into a beautiful traditional oil painting on canvas.

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

Make it look like a museum-quality oil painting that was hand-painted on canvas with thick brushstrokes. NOT a photo filter - a real painted look.`

  console.log('Sending prompt to Gemini...')
  const result = await model.generateContent([
    { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
    prompt
  ])

  const response = await result.response
  console.log('Gemini response received')

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
