import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import sharp from 'sharp'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const inputDir = path.join(process.env.HOME, 'Downloads', 'couple=photos=ai')
const outputDir = path.join(__dirname, '..', '..', 'client', 'public', 'slideshow')

// Artistic themes for couple transformation
const themes = [
  {
    name: 'ghibli',
    prompt: 'Transform this couple photo into Studio Ghibli anime art style. Soft, dreamy, hand-painted look with warm colors, gentle lighting, whimsical atmosphere like Spirited Away or Howl\'s Moving Castle. Keep the couple recognizable but stylized as Ghibli characters.'
  },
  {
    name: 'disney',
    prompt: 'Transform this couple photo into Disney/Pixar 3D animation style. Expressive eyes, smooth textures, vibrant colors, magical Disney aesthetic. The couple should look like they belong in a Disney movie.'
  },
  {
    name: 'anime',
    prompt: 'Transform this couple photo into beautiful anime art style. Detailed eyes, soft shading, romantic shoujo manga aesthetic with sparkles and soft lighting. Keep them recognizable as an anime couple.'
  },
  {
    name: 'watercolor',
    prompt: 'Transform this couple photo into a beautiful watercolor painting. Soft, flowing colors, artistic brush strokes, romantic and dreamy aesthetic. Like a fine art wedding portrait.'
  },
  {
    name: 'renaissance',
    prompt: 'Transform this couple photo into a Renaissance oil painting style. Classical composition, rich colors, dramatic lighting like Rembrandt or Vermeer. Elegant and timeless artistic portrait.'
  },
  {
    name: 'fantasy',
    prompt: 'Transform this couple photo into a magical fantasy art style. Ethereal lighting, magical sparkles, enchanted forest or fairy tale atmosphere. Romantic and mystical.'
  },
  {
    name: 'popart',
    prompt: 'Transform this couple photo into Andy Warhol pop art style. Bold colors, high contrast, graphic design aesthetic with halftone dots. Vibrant and iconic.'
  },
  {
    name: 'romantic',
    prompt: 'Transform this couple photo into a dreamy romantic portrait. Soft focus, golden hour lighting, rose petals floating, soft pink and warm tones. Valentine\'s Day aesthetic.'
  }
]

async function preprocessImage(imagePath) {
  const buffer = await fs.readFile(imagePath)

  // Convert to JPEG and resize for API
  const processed = await sharp(buffer, { failOn: 'none' })
    .rotate() // Auto-rotate based on EXIF
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()

  return processed
}

async function convertImage(imageBuffer, theme, photoName, index) {
  try {
    console.log(`  Converting to ${theme.name} style...`)

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    })

    const base64Image = imageBuffer.toString('base64')

    const fullPrompt = `${theme.prompt}

Requirements:
- Portrait/vertical orientation ideal for phone wallpaper
- Ultra high quality output
- Maintain the couple's essence and connection
- Romantic, Valentine's Day mood
- Professional artistic quality
- No text or watermarks`

    const result = await model.generateContent([
      fullPrompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image
        }
      }
    ])

    const response = await result.response

    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const buffer = Buffer.from(part.inlineData.data, 'base64')
          const filename = `couple-${photoName}-${theme.name}.jpg`
          const filepath = path.join(outputDir, filename)
          await fs.writeFile(filepath, buffer)
          console.log(`    ✓ Saved: ${filename}`)
          return filename
        }
      }
    }
    throw new Error('No image in response')
  } catch (error) {
    console.error(`    ✗ Failed ${theme.name}:`, error.message)
    return null
  }
}

async function main() {
  console.log('🎨 Converting Couple Photos to Artistic Themes\n')

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true })

  // Get all images from input directory
  const files = await fs.readdir(inputDir)
  const imageFiles = files.filter(f =>
    /\.(jpg|jpeg|png|webp)$/i.test(f)
  )

  console.log(`Found ${imageFiles.length} couple photos to convert\n`)

  const results = []

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]
    const photoName = path.basename(file, path.extname(file)).substring(0, 10).replace(/[^a-zA-Z0-9]/g, '')

    console.log(`\n📷 Processing photo ${i + 1}/${imageFiles.length}: ${file}`)

    try {
      const imagePath = path.join(inputDir, file)
      const imageBuffer = await preprocessImage(imagePath)

      // Convert to each theme
      for (const theme of themes) {
        const filename = await convertImage(imageBuffer, theme, photoName, i)
        if (filename) {
          results.push(filename)
        }
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    } catch (error) {
      console.error(`  Error processing ${file}:`, error.message)
    }
  }

  console.log(`\n\n✨ Generated ${results.length} themed couple portraits`)

  // Update manifest to include new images
  let manifest = { images: [], generatedAt: new Date().toISOString() }
  try {
    const existingManifest = await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf-8')
    manifest = JSON.parse(existingManifest)
  } catch {}

  // Add new images to manifest (avoid duplicates)
  const existingSet = new Set(manifest.images)
  for (const img of results) {
    if (!existingSet.has(img)) {
      manifest.images.push(img)
    }
  }

  manifest.generatedAt = new Date().toISOString()
  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  console.log('📝 Updated manifest.json')
}

main().catch(console.error)
