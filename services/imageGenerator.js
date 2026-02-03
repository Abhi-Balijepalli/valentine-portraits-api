import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'
import { GoogleGenerativeAI } from '@google/generative-ai'
import convert from 'heic-convert'
import { createClient } from '@supabase/supabase-js'

// Lazy initialize Supabase
let supabase = null
function getSupabase() {
  if (supabase === null && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    console.log('Initializing Supabase client...')
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  }
  return supabase
}

const BUCKET_NAME = 'images'

// Lazy initialize Gemini (to ensure env vars are loaded)
let genAI = null
function getGenAI() {
  if (genAI === null && process.env.GEMINI_API_KEY) {
    console.log('Initializing Gemini AI with API key...')
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return genAI
}

// Theme prompts for AI generation - ALL ANIMATED/ARTISTIC STYLES
const themePrompts = {
  renaissance: {
    style: 'Renaissance Oil Painting',
    prompt: 'Transform this couple photo into a CLASSICAL RENAISSANCE OIL PAINTING in the style of Raphael and Botticelli. Make it look like an ACTUAL PAINTED CANVAS with visible brushstrokes, rich oil paint texture, warm golden undertones, dramatic chiaroscuro lighting. The couple should wear elegant Renaissance era clothing. Background should be classical Italian architecture or soft draped fabric. This must look like a 500-year-old masterpiece painting, NOT a photo filter. Full artistic transformation into painted art.'
  },
  vangogh: {
    style: 'Van Gogh Painting',
    prompt: 'Transform this couple photo into a Vincent Van Gogh PAINTING with his iconic swirling brushstroke style. Thick impasto paint texture, bold expressive brushstrokes, vibrant colors with blues, yellows, and greens. Swirling sky background like Starry Night. The couple should look like painted figures in Van Gogh\'s post-impressionist style. This must look like an ACTUAL Van Gogh painting with visible paint texture, NOT a photo.'
  },
  ghibli: {
    style: 'Studio Ghibli Anime',
    prompt: 'Transform this couple photo into beautiful STUDIO GHIBLI ANIME ART style like from Spirited Away or Howl\'s Moving Castle. Soft hand-drawn anime aesthetic, gentle pastel colors, dreamy atmospheric lighting, whimsical romantic mood. The couple should be drawn as anime characters with expressive eyes and soft features. Add magical floating elements like flower petals or sparkles. Hayao Miyazaki style animation art. This must look hand-drawn and animated, NOT realistic.'
  },
  disney: {
    style: 'Disney/Pixar Animation',
    prompt: 'Transform this couple photo into DISNEY PIXAR 3D ANIMATION style. Big expressive cartoon eyes, smooth stylized features, perfect skin, warm magical lighting. The couple should look like characters from a Disney princess movie or Pixar film. Romantic fairy tale aesthetic with soft glowing background. Professional animation studio quality. This must look like a still from an animated movie, NOT a real photo.'
  },
  anime: {
    style: 'Japanese Anime',
    prompt: 'Transform this couple photo into beautiful JAPANESE ANIME illustration style. Clean anime line art, big sparkling eyes, soft cel-shaded coloring, romantic shoujo manga aesthetic. Add sparkles, flower petals, and soft pink lighting. The couple should look like anime characters from a romance anime. Detailed hair and expressive faces. This must look like hand-drawn anime art, NOT realistic.'
  },
  watercolor: {
    style: 'Watercolor Painting',
    prompt: 'Transform this couple photo into a beautiful WATERCOLOR PAINTING. Soft flowing colors that bleed into each other, visible paper texture, delicate artistic brushstrokes, dreamy ethereal quality. Soft pink, peach, and lavender tones. White space and artistic splashes. The couple should look painted with watercolor, with soft edges and artistic interpretation. This must look like an ACTUAL watercolor painting on paper, NOT a photo.'
  }
}

// Fallback: Sharp-based transformations when AI is unavailable
const sharpTransforms = {
  renaissance: async (image) => {
    return image
      .modulate({ brightness: 1.05, saturation: 0.8 })
      .tint({ r: 220, g: 200, b: 170 })
      .sharpen()
  },
  vangogh: async (image) => {
    return image
      .modulate({ brightness: 1.1, saturation: 1.5 })
      .sharpen({ sigma: 3 })
  },
  ghibli: async (image) => {
    return image
      .modulate({ brightness: 1.15, saturation: 1.2 })
      .sharpen({ sigma: 1.5 })
      .median(1)
  },
  disney: async (image) => {
    return image
      .modulate({ brightness: 1.1, saturation: 1.4 })
      .sharpen({ sigma: 2 })
      .median(1)
  },
  anime: async (image) => {
    return image
      .modulate({ brightness: 1.1, saturation: 1.3 })
      .sharpen({ sigma: 2.5 })
      .median(1)
  },
  watercolor: async (image) => {
    return image
      .modulate({ brightness: 1.1, saturation: 0.7 })
      .blur(0.5)
      .sharpen({ sigma: 0.5 })
  }
}

/**
 * Check if buffer is HEIC/HEIF format
 */
function isHeic(buffer) {
  if (buffer.length < 12) return false
  const brand = buffer.slice(8, 12).toString('ascii')
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1'].includes(brand.toLowerCase())
}

/**
 * Convert HEIC to JPEG buffer
 */
async function convertHeicToJpeg(buffer) {
  try {
    console.log('Converting HEIC to JPEG...')
    const outputBuffer = await convert({
      buffer: buffer,
      format: 'JPEG',
      quality: 0.95
    })
    console.log('HEIC conversion successful')
    return Buffer.from(outputBuffer)
  } catch (error) {
    console.error('HEIC conversion error:', error.message)
    throw error
  }
}

/**
 * Pre-process image buffer to handle various formats (HEIF, HEIC, etc)
 */
async function preprocessImage(imageBuffer) {
  let buffer = imageBuffer

  if (isHeic(buffer)) {
    console.log('Detected HEIC format, converting...')
    buffer = await convertHeicToJpeg(buffer)
  }

  try {
    const processedBuffer = await sharp(buffer, {
      failOn: 'none',
      limitInputPixels: false
    })
      .rotate()
      .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 95 })
      .toBuffer()

    return processedBuffer
  } catch (error) {
    console.error('Sharp preprocessing error:', error.message)
    if (buffer !== imageBuffer) {
      return buffer
    }
    throw error
  }
}

/**
 * Upload image to Supabase Storage
 */
async function uploadToSupabase(imageBuffer, imageId) {
  const sb = getSupabase()
  if (!sb) {
    throw new Error('Supabase not configured')
  }

  const filename = `valentines/${imageId}.jpg`

  console.log(`Uploading to Supabase: ${filename}`)

  const { data, error } = await sb.storage
    .from(BUCKET_NAME)
    .upload(filename, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    })

  if (error) {
    console.error('Supabase upload error:', error)
    throw error
  }

  // Get public URL
  const { data: urlData } = sb.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filename)

  console.log('Upload successful:', urlData.publicUrl)
  return urlData.publicUrl
}

/**
 * Generate a styled portrait using Gemini AI
 */
async function generateWithGemini(imageBuffer, theme) {
  const ai = getGenAI()
  if (!ai) {
    throw new Error('Gemini API not configured')
  }

  const themeConfig = themePrompts[theme] || themePrompts.ghibli

  try {
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash-exp-image-generation',
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    })

    const base64Image = imageBuffer.toString('base64')

    const prompt = `${themeConfig.prompt}

IMPORTANT: Create a complete ARTISTIC TRANSFORMATION. The result must look like ${themeConfig.style}, NOT like a real photograph. Keep the couple recognizable but fully transform them into this art style. Make it romantic and Valentine's Day worthy.`

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image
        }
      },
      prompt
    ])

    const response = await result.response

    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return Buffer.from(part.inlineData.data, 'base64')
        }
      }
    }

    throw new Error('No image generated in response')
  } catch (error) {
    console.error('Gemini generation error:', error.message)
    throw error
  }
}

/**
 * Generate a styled portrait from an uploaded image
 */
export async function generatePortrait(imageBuffer, theme) {
  const imageId = uuidv4()

  // Pre-process image
  console.log('Pre-processing image...')
  let processedBuffer
  try {
    processedBuffer = await preprocessImage(imageBuffer)
    console.log('Image preprocessing successful')
  } catch (error) {
    console.error('Preprocessing failed:', error.message)
    throw new Error('Unable to process this image format. Please try a different photo or convert to JPG/PNG first.')
  }

  let outputBuffer

  // Try Gemini AI first
  if (getGenAI()) {
    try {
      console.log(`Generating ${theme} portrait with Gemini AI...`)
      outputBuffer = await generateWithGemini(processedBuffer, theme)

      // Process the AI output
      outputBuffer = await sharp(outputBuffer)
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer()

      console.log('AI generation successful')
    } catch (error) {
      console.log('AI generation failed, falling back to filters:', error.message)
      outputBuffer = null
    }
  }

  // Fallback to Sharp-based transformations
  if (!outputBuffer) {
    console.log(`Generating ${theme} portrait with Sharp filters...`)
    let image = sharp(processedBuffer)

    const transform = sharpTransforms[theme] || sharpTransforms.ghibli
    image = await transform(image)

    outputBuffer = await image.jpeg({ quality: 90 }).toBuffer()
  }

  // Upload to Supabase
  let imageUrl
  try {
    imageUrl = await uploadToSupabase(outputBuffer, imageId)
  } catch (error) {
    console.error('Failed to upload to Supabase:', error.message)
    throw new Error('Failed to save generated image')
  }

  return {
    imageId,
    imageUrl
  }
}

/**
 * Store mapping of image IDs to their metadata
 */
const imageStore = new Map()

export function storeImageMetadata(imageId, metadata) {
  imageStore.set(imageId, {
    ...metadata,
    createdAt: new Date().toISOString()
  })
}

export function getImageMetadata(imageId) {
  return imageStore.get(imageId)
}

export function getImagePath(imageId) {
  // For backwards compatibility with payment route
  const metadata = imageStore.get(imageId)
  return metadata?.imageUrl || null
}
